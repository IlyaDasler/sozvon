#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Явная папка WebView2: в урезанной сессии стандартный TEMP может быть
            // недоступен (os error 5). Для обычного запуска можно задать свой путь.
            let data = std::env::var("SOZVON_PILOT_DATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| std::env::temp_dir().join("sozvon-pilot-webview"));
            std::fs::create_dir_all(&data)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Sozvon Pilot")
                .inner_size(900.0, 620.0)
                .data_directory(data)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri pilot failed");
}
