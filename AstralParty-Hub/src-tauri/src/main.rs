// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(any(not(debug_assertions), feature = "launcher-preview"), windows_subsystem = "windows")]

fn main() {
    astralparty_hub_lib::run()
}
