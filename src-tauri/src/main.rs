// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // In release mode the app is a GUI subsystem process with no console.
    // When portable-pty creates a ConPTY, Windows allocates a visible console
    // window because there isn't one to reuse.  Allocate a hidden console up
    // front so ConPTY can attach to it silently.
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    {
        unsafe {
            use windows_sys::Win32::System::Console::AllocConsole;
            use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
            use windows_sys::Win32::System::Console::GetConsoleWindow;
            AllocConsole();
            let hwnd = GetConsoleWindow();
            if hwnd != std::ptr::null_mut() {
                ShowWindow(hwnd, SW_HIDE);
            }
        }
    }

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
