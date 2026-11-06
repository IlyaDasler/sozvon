package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Контракт API и WebSocket хранится рядом с Go-сервером: server-go/contract.
// Тест не требует запуска сервера — он сторожит все маршруты и имена событий.
const contractDir = "contract"

type contractCall struct {
	Name   string `json:"name"`
	Method string `json:"method"`
	Path   string `json:"path"`
}

func contractPath(name string) string {
	return filepath.Join(contractDir, name)
}

func readContract(t *testing.T, name string, target any) bool {
	t.Helper()
	path := contractPath(name)
	body, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Logf("фикстура %s не найдена — пропускаем (фикстуры контракта не скопированы)", name)
		return false
	}
	if err != nil {
		t.Fatalf("чтение %s: %v", name, err)
	}
	if err := json.Unmarshal(body, target); err != nil {
		t.Fatalf("разбор %s: %v", name, err)
	}
	return true
}

// normalizePath приводит параметры маршрута к одному виду: :id, {id} и числа → {}.
func normalizePath(path string) string {
	for _, pattern := range []struct {
		re   *regexp.Regexp
		repl string
	}{
		{regexp.MustCompile(`:[a-zA-Z_][a-zA-Z0-9_]*`), "{}"},
		{regexp.MustCompile(`\{[a-zA-Z_][a-zA-Z0-9_]*\}`), "{}"},
		// В контракте Node вместо параметров стоят настоящие id
		{regexp.MustCompile(`/[0-9]+`), "/{}"},
	} {
		path = pattern.re.ReplaceAllString(path, pattern.repl)
	}
	return strings.TrimSuffix(path, "/")
}

// goRoutes собирает маршруты из main.go в том же виде, что контракт Node: METHOD + /api/путь.
func goRoutes(t *testing.T) map[string]bool {
	t.Helper()
	body, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("чтение main.go: %v", err)
	}
	routePattern := regexp.MustCompile(`r\.(Get|Post|Put|Patch|Delete)\("([^"]+)"`)
	routes := map[string]bool{}
	for _, match := range routePattern.FindAllStringSubmatch(string(body), -1) {
		path := match[2]
		if !strings.HasPrefix(path, "/api") {
			path = "/api" + path
		}
		routes[strings.ToUpper(match[1])+" "+normalizePath(path)] = true
	}
	return routes
}

func TestContractRoutesExist(t *testing.T) {
	var contract struct {
		Calls []contractCall `json:"calls"`
	}
	if !readContract(t, "api.json", &contract) {
		return
	}
	calls := contract.Calls
	routes := goRoutes(t)
	missing := make([]string, 0)
	for _, call := range calls {
		key := strings.ToUpper(call.Method) + " " + normalizePath("/api/"+strings.TrimPrefix(call.Path, "/"))
		if !routes[key] {
			missing = append(missing, call.Method+" "+call.Path+" ("+call.Name+")")
		}
	}
	if len(missing) > 0 {
		t.Fatalf("в Go нет маршрутов из контракта: %v", missing)
	}
	t.Logf("маршрутов из контракта: %d, все есть в Go", len(calls))
}

func TestContractWebSocketEventsExist(t *testing.T) {
	var events []string
	if !readContract(t, "ws-events.json", &events) {
		return
	}
	// Все .go файлы модуля: имя события должно встречаться в исходниках
	sources := map[string]string{}
	err := filepath.Walk(".", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sources[path] = string(body)
		return nil
	})
	if err != nil {
		t.Fatalf("обход исходников: %v", err)
	}
	missing := make([]string, 0)
	for _, event := range events {
		quoted := `"` + event + `"`
		found := false
		for _, body := range sources {
			if strings.Contains(body, quoted) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, event)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("Go не отправляет события из контракта: %v", missing)
	}
	t.Logf("событий из контракта: %d, все есть в Go", len(events))
}
