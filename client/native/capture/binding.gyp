{
  "targets": [
    {
      "target_name": "sozvon_capture",
      "sources": ["src/capture.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS", "UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
      "libraries": ["d3d11.lib", "dxgi.lib"],
      "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17", "/utf-8"] } }
    }
  ]
}
