// Package version сравнивает версии клиента «Созвона» без внешних зависимостей.
// Поддерживает формат SemVer, который использует electron-builder: 3.0.0,
// 3.0.0-beta.1, 3.0.0-rc.2. Предрелиз всегда меньше финальной версии.
package version

import (
	"strconv"
	"strings"
)

type parsed struct {
	core [3]int
	pre  []string
}

// Parse разбирает версию. Второй результат — false для пустой или мусорной строки.
func Parse(value string) (parsed, bool) {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "v")
	value = strings.TrimPrefix(value, "V")
	if value == "" {
		return parsed{}, false
	}
	var out parsed
	main := value
	if i := strings.IndexByte(value, '+'); i >= 0 {
		main = value[:i] // build metadata на сравнение не влияет
	}
	if i := strings.IndexByte(main, '-'); i >= 0 {
		out.pre = strings.Split(main[i+1:], ".")
		main = main[:i]
	}
	parts := strings.Split(main, ".")
	if len(parts) > 3 {
		return parsed{}, false
	}
	for i := 0; i < 3; i++ {
		if i >= len(parts) {
			continue
		}
		if parts[i] == "" {
			return parsed{}, false
		}
		n, err := strconv.Atoi(parts[i])
		if err != nil || n < 0 {
			return parsed{}, false
		}
		out.core[i] = n
	}
	for _, p := range out.pre {
		if p == "" {
			return parsed{}, false
		}
	}
	return out, true
}

func comparePre(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	// Финальный релиз выше любого предрелиза.
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] == b[i] {
			continue
		}
		an, aerr := strconv.Atoi(a[i])
		bn, berr := strconv.Atoi(b[i])
		switch {
		case aerr == nil && berr == nil:
			if an < bn {
				return -1
			}
			return 1
		case aerr == nil:
			return -1 // числовой идентификатор ниже текстового
		case berr == nil:
			return 1
		default:
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return 0
}

// Compare возвращает -1, 0 или 1. Невалидные версии считаются самыми старыми.
func Compare(a, b string) int {
	pa, oka := Parse(a)
	pb, okb := Parse(b)
	if !oka && !okb {
		return 0
	}
	if !oka {
		return -1
	}
	if !okb {
		return 1
	}
	for i := 0; i < 3; i++ {
		if pa.core[i] < pb.core[i] {
			return -1
		}
		if pa.core[i] > pb.core[i] {
			return 1
		}
	}
	return comparePre(pa.pre, pb.pre)
}

// AtLeast сообщает, что value не ниже minimum.
func AtLeast(value, minimum string) bool {
	return Compare(value, minimum) >= 0
}
