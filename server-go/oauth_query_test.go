package main

import (
	"net/url"
	"testing"
)

func TestOAuthQueryEscapeRoundTripsProviderErrors(t *testing.T) {
	value := "провайдер: ошибка %2F & состояние? #1 + пробел"
	encoded := urlQueryEscape(value)
	parsed, err := url.ParseQuery("oauth_error=" + encoded)
	if err != nil {
		t.Fatalf("encoded error is not a valid query: %v", err)
	}
	if got := parsed.Get("oauth_error"); got != value {
		t.Fatalf("decoded error = %q, want %q", got, value)
	}
}
