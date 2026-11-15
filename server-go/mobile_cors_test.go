package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestMobileCORSHealthAndPreflight(t *testing.T) {
	router := chi.NewRouter()
	router.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := (&server{}).mobileCORS(router)

	get := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	get.Header.Set("Origin", "https://localhost")
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, get)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", getResponse.Code, http.StatusOK)
	}
	if got := getResponse.Header().Get("Access-Control-Allow-Origin"); got != "https://localhost" {
		t.Fatalf("health CORS origin = %q, want https://localhost", got)
	}

	preflight := httptest.NewRequest(http.MethodOptions, "/api/me", nil)
	preflight.Header.Set("Origin", "https://localhost")
	preflight.Header.Set("Access-Control-Request-Method", "GET")
	preflight.Header.Set("Access-Control-Request-Headers", "authorization")
	preflightResponse := httptest.NewRecorder()
	handler.ServeHTTP(preflightResponse, preflight)
	if preflightResponse.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", preflightResponse.Code, http.StatusNoContent)
	}
	if got := preflightResponse.Header().Get("Access-Control-Allow-Origin"); got != "https://localhost" {
		t.Fatalf("preflight CORS origin = %q, want https://localhost", got)
	}
	if got := preflightResponse.Header().Get("Access-Control-Allow-Headers"); got == "" {
		t.Fatal("preflight is missing Access-Control-Allow-Headers")
	}
}

func TestMobileCORSRejectsForeignOrigins(t *testing.T) {
	router := chi.NewRouter()
	router.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := (&server{}).mobileCORS(router)
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("foreign origin received CORS permission")
	}
}
