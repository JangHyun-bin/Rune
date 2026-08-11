use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct NativeWebviewOrigin {
    pub x: f64,
    pub y: f64,
}

#[cfg(any(test, target_os = "linux"))]
fn linux_gdk_origin(
    (_, root_x, root_y): (i32, i32, i32),
    (offset_x, offset_y): (i32, i32),
) -> NativeWebviewOrigin {
    NativeWebviewOrigin {
        x: f64::from(root_x + offset_x),
        y: f64::from(root_y + offset_y),
    }
}

#[cfg(any(test, target_os = "macos"))]
fn macos_screen_rect_origin(
    main_display_pixel_height: f64,
    primary_scale_factor: f64,
    rect_x: f64,
    rect_y: f64,
    rect_height: f64,
    safe_area_left: f64,
    safe_area_top: f64,
) -> NativeWebviewOrigin {
    let main_display_logical_height = main_display_pixel_height / primary_scale_factor;
    NativeWebviewOrigin {
        x: (rect_x + safe_area_left) * primary_scale_factor,
        y: (main_display_logical_height - rect_y - rect_height + safe_area_top)
            * primary_scale_factor,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
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

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn native_webview_origin(
    webview_window: tauri::WebviewWindow,
) -> Result<NativeWebviewOrigin, String> {
    use gtk::prelude::WidgetExt;

    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    webview_window
        .with_webview(move |webview| {
            let view = webview.inner();
            let result = (|| {
                let toplevel = view
                    .toplevel()
                    .ok_or_else(|| "Linux WebView top-level widget is unavailable".to_owned())?;
                let root_window = toplevel
                    .window()
                    .ok_or_else(|| "Linux top-level GDK window is unavailable".to_owned())?;
                let offset = view
                    .translate_coordinates(&toplevel, 0, 0)
                    .ok_or_else(|| "Linux WebView widget offset is unavailable".to_owned())?;
                Ok(linux_gdk_origin(root_window.origin(), offset))
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|error| format!("Linux WebView origin callback failed: {error}"))?
    })
    .await
    .map_err(|error| error.to_string())?
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
                let safe_area = view.safeAreaInsets();
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
                    safe_area.left,
                    safe_area.top,
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
            macos_screen_rect_origin(1800.0, 2.0, 100.0, 600.0, 200.0, 0.0, 0.0),
            NativeWebviewOrigin { x: 200.0, y: 200.0 }
        );
    }

    #[test]
    fn retains_core_graphics_menu_bar_extent_in_cursor_coordinates() {
        assert_eq!(
            macos_screen_rect_origin(928.0, 1.0, 0.0, 0.0, 875.0, 0.0, 0.0),
            NativeWebviewOrigin { x: 0.0, y: 53.0 }
        );
    }

    #[test]
    fn includes_webview_safe_area_in_the_dom_client_origin() {
        assert_eq!(
            macos_screen_rect_origin(900.0, 1.0, 0.0, 0.0, 875.0, 0.0, 28.0),
            NativeWebviewOrigin { x: 0.0, y: 53.0 }
        );
    }

    #[test]
    fn keeps_linux_gdk_root_coordinates_for_the_webview_origin() {
        assert_eq!(
            linux_gdk_origin((0, 726, 0), (0, 31)),
            NativeWebviewOrigin { x: 726.0, y: 31.0 }
        );
    }
}
