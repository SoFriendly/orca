// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // XInitThreads must be called before any other X11 calls to enable
    // multi-threaded X11 client support and prevent XCB sequence errors.
    #[cfg(target_os = "linux")]
    {
        unsafe {
            let display = x11::xlib::XInitThreads();
            if display == 0 {
                eprintln!("Warning: XInitThreads failed");
            }
        }
    }

    orca_lib::run()
}
