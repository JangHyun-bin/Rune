use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct NativeWebviewOrigin {
    pub x: f64,
    pub y: f64,
}

#[cfg(any(test, target_os = "macos"))]
fn macos_screen_rect_origin(
    main_display_pixel_height: f64,
    primary_scale_factor: f64,
    rect_x: f64,
    rect_y: f64,
    rect_height: f64,
) -> NativeWebviewOrigin {
    let main_display_logical_height = main_display_pixel_height / primary_scale_factor;
    NativeWebviewOrigin {
        x: rect_x * primary_scale_factor,
        y: (main_display_logical_height - rect_y - rect_height) * primary_scale_factor,
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn native_webview_origin(
    webview_window: tauri::WebviewWindow,
) -> Result<NativeWebviewOrigin, String> {
    let position = webview_window
        .inner_position()
        .map_err(|error| error.to_string())?;
    Ok(NativeWebviewOrigin {
        x: f64::from(position.x),
        y: f64::from(position.y),
    })
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn native_webview_origin(
    webview_window: tauri::WebviewWindow,
) -> Result<NativeWebviewOrigin, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSView, NSWindow};

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
    }

    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    webview_window
        .with_webview(move |webview| {
            let result: Result<NativeWebviewOrigin, String> = (|| {
                let mtm = unsafe { MainThreadMarker::new_unchecked() };
                let view: &NSView = unsafe { &*webview.inner().cast() };
                let window: &NSWindow = unsafe { &*webview.ns_window().cast() };
                let rect_in_window = view.convertRect_toView(view.bounds(), None);
                let rect_on_screen = window.convertRectToScreen(rect_in_window);
                let main_screen = NSScreen::mainScreen(mtm)
                    .ok_or_else(|| "macOS main screen is unavailable".to_owned())?;
                // Match Tauri/Tao's cursor coordinate space. NSScreen::frame can omit the
                // menu-bar strip on hosted macOS displays, while cursorPosition() is based
                // on the CoreGraphics main-display height.
                let main_display_pixel_height =
                    unsafe { CGDisplayPixelsHigh(CGMainDisplayID()) as f64 };
                Ok(macos_screen_rect_origin(
                    main_display_pixel_height,
                    main_screen.backingScaleFactor(),
                    rect_on_screen.origin.x,
                    rect_on_screen.origin.y,
                    rect_on_screen.size.height,
                ))
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|error| format!("native WebView origin callback failed: {error}"))?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_macos_bottom_left_rect_to_cursor_physical_origin() {
        assert_eq!(
            macos_screen_rect_origin(1800.0, 2.0, 100.0, 600.0, 200.0),
            NativeWebviewOrigin { x: 200.0, y: 200.0 }
        );
    }

    #[test]
    fn retains_core_graphics_menu_bar_extent_in_cursor_coordinates() {
        assert_eq!(
            macos_screen_rect_origin(928.0, 1.0, 0.0, 0.0, 875.0),
            NativeWebviewOrigin { x: 0.0, y: 53.0 }
        );
    }
}
