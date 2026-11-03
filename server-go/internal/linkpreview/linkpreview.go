package linkpreview

import (
	"context"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Предпросмотр ссылок: заголовок, описание и картинка страницы.
// Сервер ходит только на публичные адреса — localhost и локальные сети закрыты,
// кроме режима тестов LINK_PREVIEW_ALLOW_PRIVATE=1.

const (
	timeout      = 5 * time.Second
	maxBytes     = 512 * 1024
	maxRedirects = 3
	cacheTTL     = time.Hour
	cacheSize    = 300
)

type Preview struct {
	URL         string  `json:"url"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	Image       *string `json:"image"`
	Video       *string `json:"video"`
	SiteName    string  `json:"siteName"`
}

type Fetcher struct {
	AllowPrivate bool
	client       *http.Client
	mu           sync.Mutex
	cache        map[string]cacheEntry
}

type cacheEntry struct {
	preview *Preview
	at      time.Time
}

func New(allowPrivate bool) *Fetcher {
	f := &Fetcher{AllowPrivate: allowPrivate, cache: map[string]cacheEntry{}}
	transport := &http.Transport{
		DialContext:           f.safeDial,
		TLSHandshakeTimeout:   timeout,
		ResponseHeaderTimeout: timeout,
		MaxIdleConns:          10,
	}
	f.client = &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return errors.New("слишком много переадресаций")
			}
			if !previewable(req.URL) {
				return errors.New("адрес закрыт для предпросмотра")
			}
			return nil
		},
	}
	return f
}

func previewable(u *url.URL) bool {
	return u != nil && (u.Scheme == "http" || u.Scheme == "https")
}

// PreviewableURL — только http/https, разумной длины.
func PreviewableURL(value string) *url.URL {
	if value == "" || len(value) > 2048 {
		return nil
	}
	u, err := url.Parse(value)
	if err != nil || !previewable(u) || u.Host == "" {
		return nil
	}
	return u
}

func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip4 := ip.To4(); ip4 != nil {
		a, b := ip4[0], ip4[1]
		switch {
		case a == 0, a == 10, a == 127, a >= 224:
			return false
		case a == 100 && b >= 64 && b <= 127:
			return false
		case a == 169 && b == 254:
			return false
		case a == 172 && b >= 16 && b <= 31:
			return false
		case a == 192 && b == 168:
			return false
		case a == 198 && (b == 18 || b == 19):
			return false
		}
		return true
	}
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	return true
}

// safeDial проверяет адрес в момент соединения: DNS-подмена не проведёт внутрь сети.
func (f *Fetcher) safeDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if !f.AllowPrivate && !isPublicIP(ip) {
			return nil, errors.New("адрес закрыт для предпросмотра")
		}
	}
	dialer := &net.Dialer{Timeout: timeout}
	var last error
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}

var (
	metaTagPattern  = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	titlePattern    = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	charsetPattern  = regexp.MustCompile(`(?i)charset=["']?([\w-]+)`)
	attrNamePattern = regexp.MustCompile(`(?i)\b(property|name)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`)
	attrDataPattern = regexp.MustCompile(`(?i)\bcontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))`)
)

func clean(value string, max int) *string {
	value = strings.Join(strings.Fields(html.UnescapeString(value)), " ")
	if value == "" {
		return nil
	}
	runes := []rune(value)
	if len(runes) > max {
		value = string(runes[:max-1]) + "…"
	}
	return &value
}

func firstGroup(groups []string) string {
	for _, value := range groups {
		if value != "" {
			return value
		}
	}
	return ""
}

func metaTags(page string) map[string]string {
	meta := map[string]string{}
	for _, tag := range metaTagPattern.FindAllString(page, -1) {
		nameMatch := attrNamePattern.FindStringSubmatch(tag)
		if nameMatch == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(firstGroup(nameMatch[3:])))
		contentMatch := attrDataPattern.FindStringSubmatch(tag)
		if key == "" || contentMatch == nil {
			continue
		}
		if _, exists := meta[key]; !exists {
			meta[key] = firstGroup(contentMatch[2:])
		}
	}
	return meta
}

// ParsePreview — из HTML страницы; nil, если заголовка нет.
func ParsePreview(page string, pageURL string) *Preview {
	meta := metaTags(page)
	title := clean(firstNonEmpty(meta["og:title"], meta["twitter:title"], func() string {
		if match := titlePattern.FindStringSubmatch(page); match != nil {
			return match[1]
		}
		return ""
	}()), 200)
	if title == nil {
		return nil
	}
	base, _ := url.Parse(pageURL)
	resolve := func(raw string) *string {
		if raw == "" {
			return nil
		}
		ref, err := url.Parse(strings.TrimSpace(html.UnescapeString(raw)))
		if err != nil || base == nil {
			return nil
		}
		resolved := base.ResolveReference(ref)
		if resolved.Scheme != "http" && resolved.Scheme != "https" {
			return nil
		}
		text := resolved.String()
		return &text
	}
	image := resolve(firstNonEmpty(meta["og:image"], meta["og:image:url"], meta["twitter:image"]))
	video := resolve(firstNonEmpty(meta["og:video:secure_url"], meta["og:video:url"], meta["og:video"], meta["twitter:player:stream"]))
	if video != nil && !regexp.MustCompile(`(?i)\.(mp4|webm|ogv|m4v|mov|m3u8)([?#]|$)`).MatchString(*video) {
		video = nil
	}
	siteName := clean(meta["og:site_name"], 80)
	preview := &Preview{
		URL:         pageURL,
		Title:       *title,
		Description: clean(firstNonEmpty(meta["og:description"], meta["twitter:description"], meta["description"]), 300),
		Image:       image,
		Video:       video,
	}
	if siteName != nil {
		preview.SiteName = *siteName
	} else if base != nil {
		preview.SiteName = strings.TrimPrefix(base.Hostname(), "www.")
	}
	return preview
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// Fetch — превью страницы или nil. Любая ошибка — просто сообщение без превью.
func (f *Fetcher) Fetch(rawURL string) *Preview {
	target := PreviewableURL(rawURL)
	if target == nil {
		return nil
	}
	key := target.String()
	f.mu.Lock()
	if entry, ok := f.cache[key]; ok && time.Since(entry.at) < cacheTTL {
		f.mu.Unlock()
		return entry.preview
	}
	f.mu.Unlock()

	preview := f.load(target)
	f.mu.Lock()
	if len(f.cache) >= cacheSize {
		for cacheKey := range f.cache {
			delete(f.cache, cacheKey)
			break
		}
	}
	f.cache[key] = cacheEntry{preview: preview, at: time.Now()}
	f.mu.Unlock()
	return preview
}

func (f *Fetcher) load(target *url.URL) *Preview {
	request, err := http.NewRequest(http.MethodGet, target.String(), nil)
	if err != nil {
		return nil
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (compatible; SozvonPreview/1.0)")
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Accept-Language", "ru,en;q=0.8")
	response, err := f.client.Do(request)
	if err != nil {
		return nil
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil
	}
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "application/xhtml") {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes))
	if err != nil && len(body) == 0 {
		return nil
	}
	return ParsePreview(string(body), target.String())
}

var _ = charsetPattern
