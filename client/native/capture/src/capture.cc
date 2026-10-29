// Захват экрана для трансляции: DXGI Desktop Duplication → уменьшение на видеокарте → общая текстура.
// Chromium тратит на кадр 3440×1440 около 20 мс (потолок ~51 к/с), сама Windows отдаёт его за 2,5 мс.
// Кадр не покидает видеопамять: текстуру по NT HANDLE забирает Electron (sharedTexture) и отдаёт окну как VideoFrame.
//
// JS:
//   outputs() → [{ index, name, left, top, right, bottom }]  — мониторы в физических пикселях
//   start({ output, width, height, fps }, onFrame(slot, handle, timestampUs)) → { release(slot), stop() }
//   Кадр кладётся в одну из SLOTS текстур; пока окно её не вернуло (release), слот не переписываем.

#include <napi.h>
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <atomic>
#include <chrono>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

constexpr int SLOTS = 4;

struct Output {
  ComPtr<IDXGIAdapter1> adapter;
  ComPtr<IDXGIOutput1> output;
  DXGI_OUTPUT_DESC desc;
};

std::vector<Output> ListOutputs() {
  std::vector<Output> out;
  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return out;
  ComPtr<IDXGIAdapter1> adapter;
  for (UINT a = 0; factory->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; a++) {
    ComPtr<IDXGIOutput> o;
    for (UINT i = 0; adapter->EnumOutputs(i, &o) != DXGI_ERROR_NOT_FOUND; i++) {
      Output item;
      item.adapter = adapter;
      if (SUCCEEDED(o.As(&item.output)) && SUCCEEDED(o->GetDesc(&item.desc)) && item.desc.AttachedToDesktop) out.push_back(item);
    }
  }
  return out;
}

std::string Utf8(const wchar_t* w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
  return s;
}

Napi::Value Outputs(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  auto list = ListOutputs();
  auto arr = Napi::Array::New(env, list.size());
  for (size_t i = 0; i < list.size(); i++) {
    auto o = Napi::Object::New(env);
    const auto& r = list[i].desc.DesktopCoordinates;
    o.Set("index", (double)i);
    o.Set("name", Utf8(list[i].desc.DeviceName));
    o.Set("left", (double)r.left);
    o.Set("top", (double)r.top);
    o.Set("right", (double)r.right);
    o.Set("bottom", (double)r.bottom);
    arr.Set((uint32_t)i, o);
  }
  return arr;
}

struct FrameMsg {
  int slot;
  double timestampUs;
};

class Capture : public Napi::ObjectWrap<Capture> {
 public:
  static Napi::Function Init(Napi::Env env) {
    return DefineClass(env, "Capture", {InstanceMethod("release", &Capture::Release), InstanceMethod("stop", &Capture::Stop)});
  }

  Capture(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Capture>(info) {
    auto env = info.Env();
    auto opts = info[0].As<Napi::Object>();
    outputIndex_ = opts.Get("output").As<Napi::Number>().Int32Value();
    width_ = opts.Get("width").As<Napi::Number>().Int32Value();
    height_ = opts.Get("height").As<Napi::Number>().Int32Value();
    fps_ = opts.Get("fps").As<Napi::Number>().Int32Value();
    std::string err = Setup();
    if (!err.empty()) {
      Napi::Error::New(env, err).ThrowAsJavaScriptException();
      return;
    }
    // Ручки текстур отдаём сразу: JS импортирует их один раз на слот
    tsfn_ = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "sozvon-capture", 0, 1);
    for (int i = 0; i < SLOTS; i++) free_[i] = true;
    running_ = true;
    thread_ = std::thread([this] { Loop(); });
  }

  ~Capture() { Shutdown(); }

  Napi::Value HandleOf(Napi::Env env, int slot) {
    return Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<uint8_t*>(&handles_[slot]), sizeof(HANDLE));
  }

 private:
  std::string Setup() {
    auto outputs = ListOutputs();
    if (outputIndex_ < 0 || outputIndex_ >= (int)outputs.size()) return "Нет такого монитора";
    auto& o = outputs[outputIndex_];
    const auto& r = o.desc.DesktopCoordinates;
    srcW_ = r.right - r.left;
    srcH_ = r.bottom - r.top;
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    if (FAILED(D3D11CreateDevice(o.adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                                 levels, 2, D3D11_SDK_VERSION, &device_, nullptr, &context_)))
      return "Не создать устройство Direct3D";
    output_ = o.output;
    if (FAILED(output_->DuplicateOutput(device_.Get(), &dup_))) return "Windows не даёт захватить этот монитор";

    // Кадр монитора копируем в свою текстуру — её понимает видеопроцессор
    D3D11_TEXTURE2D_DESC d = {};
    d.Width = srcW_;
    d.Height = srcH_;
    d.MipLevels = 1;
    d.ArraySize = 1;
    d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    d.SampleDesc.Count = 1;
    d.Usage = D3D11_USAGE_DEFAULT;
    d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(device_->CreateTexture2D(&d, nullptr, &staging_))) return "Не создать текстуру кадра";

    // Слоты на выход: уменьшенный кадр BGRA, общий по NT HANDLE
    d.Width = width_;
    d.Height = height_;
    d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
    for (int i = 0; i < SLOTS; i++) {
      if (FAILED(device_->CreateTexture2D(&d, nullptr, &slots_[i]))) return "Не создать общую текстуру";
      ComPtr<IDXGIResource1> res;
      slots_[i].As(&res);
      if (FAILED(res->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &handles_[i])))
        return "Не создать ручку общей текстуры";
    }

    // Видеопроцессор уменьшает кадр на видеокарте
    if (FAILED(device_.As(&vdev_)) || FAILED(context_.As(&vctx_))) return "Нет видеопроцессора";
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC cd = {};
    cd.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    cd.InputWidth = srcW_;
    cd.InputHeight = srcH_;
    cd.OutputWidth = width_;
    cd.OutputHeight = height_;
    cd.InputFrameRate = {(UINT)fps_, 1};
    cd.OutputFrameRate = {(UINT)fps_, 1};
    cd.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
    if (FAILED(vdev_->CreateVideoProcessorEnumerator(&cd, &venum_)) || FAILED(vdev_->CreateVideoProcessor(venum_.Get(), 0, &vproc_)))
      return "Не создать видеопроцессор";
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC iv = {};
    iv.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
    if (FAILED(vdev_->CreateVideoProcessorInputView(staging_.Get(), venum_.Get(), &iv, &inView_))) return "Видеопроцессор не принимает кадр";
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ov = {};
    ov.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    for (int i = 0; i < SLOTS; i++)
      if (FAILED(vdev_->CreateVideoProcessorOutputView(slots_[i].Get(), venum_.Get(), &ov, &outView_[i]))) return "Видеопроцессор не пишет в текстуру";
    RECT src = {0, 0, srcW_, srcH_};
    vctx_->VideoProcessorSetStreamSourceRect(vproc_.Get(), 0, TRUE, &src);
    vctx_->VideoProcessorSetStreamAutoProcessingMode(vproc_.Get(), 0, FALSE);
    D3D11_QUERY_DESC qd = {D3D11_QUERY_EVENT, 0};
    device_->CreateQuery(&qd, &done_);
    return "";
  }

  // Новый кадр монитора → свободный слот → onFrame. Чаще fps не шлём: монитор 144 Гц, трансляция 60
  void Loop() {
    using clock = std::chrono::steady_clock;
    const auto interval = std::chrono::microseconds(1000000 / fps_);
    auto next = clock::now();
    while (running_) {
      DXGI_OUTDUPL_FRAME_INFO fi;
      ComPtr<IDXGIResource> res;
      HRESULT hr = dup_->AcquireNextFrame(100, &fi, &res);
      if (hr == DXGI_ERROR_WAIT_TIMEOUT) continue;
      if (hr == DXGI_ERROR_ACCESS_LOST) {
        // Сменился режим экрана или открылся UAC — пересоздаём захват
        dup_.Reset();
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        output_->DuplicateOutput(device_.Get(), &dup_);
        if (!dup_) std::this_thread::sleep_for(std::chrono::milliseconds(500));
        continue;
      }
      if (FAILED(hr)) break;
      bool fresh = fi.LastPresentTime.QuadPart != 0;
      auto now = clock::now();
      int slot = fresh && now >= next ? TakeSlot() : -1;
      if (slot >= 0) {
        ComPtr<ID3D11Texture2D> frame;
        res.As(&frame);
        context_->CopyResource(staging_.Get(), frame.Get());
        dup_->ReleaseFrame();
        D3D11_VIDEO_PROCESSOR_STREAM stream = {};
        stream.Enable = TRUE;
        stream.pInputSurface = inView_.Get();
        vctx_->VideoProcessorBlt(vproc_.Get(), outView_[slot].Get(), 0, 1, &stream);
        context_->End(done_.Get());
        context_->Flush();
        while (context_->GetData(done_.Get(), nullptr, 0, 0) == S_FALSE && running_) std::this_thread::yield();
        next = std::max(next + interval, now);
        auto msg = new FrameMsg{slot, (double)std::chrono::duration_cast<std::chrono::microseconds>(now.time_since_epoch()).count()};
        if (tsfn_.BlockingCall(msg, [this](Napi::Env env, Napi::Function cb, FrameMsg* m) {
              cb.Call({Napi::Number::New(env, m->slot), HandleOf(env, m->slot), Napi::Number::New(env, m->timestampUs)});
              delete m;
            }) != napi_ok)
          delete msg;
      } else {
        dup_->ReleaseFrame();
      }
    }
  }

  int TakeSlot() {
    std::lock_guard<std::mutex> lock(mu_);
    for (int i = 0; i < SLOTS; i++)
      if (free_[i]) {
        free_[i] = false;
        return i;
      }
    return -1;  // окно не успевает забирать — кадр пропускаем
  }

  Napi::Value Release(const Napi::CallbackInfo& info) {
    int slot = info[0].As<Napi::Number>().Int32Value();
    std::lock_guard<std::mutex> lock(mu_);
    if (slot >= 0 && slot < SLOTS) free_[slot] = true;
    return info.Env().Undefined();
  }

  Napi::Value Stop(const Napi::CallbackInfo& info) {
    Shutdown();
    return info.Env().Undefined();
  }

  void Shutdown() {
    if (!running_.exchange(false)) return;
    if (thread_.joinable()) thread_.join();
    tsfn_.Release();
    for (auto& h : handles_)
      if (h) CloseHandle(h), h = nullptr;
  }

  int outputIndex_ = 0, width_ = 0, height_ = 0, fps_ = 60, srcW_ = 0, srcH_ = 0;
  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11DeviceContext> context_;
  ComPtr<IDXGIOutput1> output_;
  ComPtr<IDXGIOutputDuplication> dup_;
  ComPtr<ID3D11Texture2D> staging_;
  ComPtr<ID3D11Texture2D> slots_[SLOTS];
  HANDLE handles_[SLOTS] = {};
  ComPtr<ID3D11VideoDevice> vdev_;
  ComPtr<ID3D11VideoContext> vctx_;
  ComPtr<ID3D11VideoProcessorEnumerator> venum_;
  ComPtr<ID3D11VideoProcessor> vproc_;
  ComPtr<ID3D11VideoProcessorInputView> inView_;
  ComPtr<ID3D11VideoProcessorOutputView> outView_[SLOTS];
  ComPtr<ID3D11Query> done_;
  Napi::ThreadSafeFunction tsfn_;
  std::thread thread_;
  std::atomic<bool> running_{false};
  std::mutex mu_;
  bool free_[SLOTS] = {};
};

Napi::FunctionReference* captureCtor = nullptr;

Napi::Value Start(const Napi::CallbackInfo& info) {
  return captureCtor->New({info[0], info[1]});
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  captureCtor = new Napi::FunctionReference(Napi::Persistent(Capture::Init(env)));
  exports.Set("outputs", Napi::Function::New(env, Outputs));
  exports.Set("start", Napi::Function::New(env, Start));
  return exports;
}

}  // namespace

NODE_API_MODULE(sozvon_capture, Init)
