import sys
import os
import time
import json
import threading
import webview

# Fix macOS Carbon/TSM dispatch_assert_queue crash in pynput:
# On macOS, pynput's keycode_context() queries Carbon TISGetInputSourceProperty.
# On newer macOS, calling this off the main thread causes a crash (SIGTRAP: _dispatch_assert_queue_fail).
# Fix: Cache keycode_context on the main thread during startup, and patch Listener._run
# so background listener threads reuse the cached context instead of calling TIS off-thread.
if sys.platform == 'darwin':
    try:
        import pynput._util.darwin as _pynput_darwin
        import pynput.keyboard._darwin as _pynput_kd

        _cached_darwin_context = None
        with _pynput_darwin.keycode_context() as _ctx:
            _cached_darwin_context = _ctx

        def _safe_darwin_listener_run(self):
            self._context = _cached_darwin_context
            try:
                super(_pynput_kd.Listener, self)._run()
            finally:
                self._context = None

        _pynput_kd.Listener._run = _safe_darwin_listener_run
    except Exception as e:
        print(f"Warning: could not patch pynput darwin Listener._run: {e}")

from pynput import mouse, keyboard

# macOS direct Quartz & AppKit support for reliable event simulation and ghost cursor overlay
IS_DARWIN = sys.platform == 'darwin'
if IS_DARWIN:
    try:
        import Quartz
        import HIServices
    except ImportError:
        Quartz = None
        HIServices = None

    try:
        import AppKit
        from AppKit import (
            NSApplication, NSWindow, NSColor, NSBackingStoreBuffered,
            NSWindowStyleMaskBorderless, NSScreen, NSView, NSBezierPath,
            NSPoint, NSMakeRect
        )
        from PyObjCTools import AppHelper
    except ImportError:
        AppKit = None
        AppHelper = None
else:
    Quartz = None
    HIServices = None
    AppKit = None
    AppHelper = None


class GhostCursorOverlay:
    """A transparent, click-through macOS overlay window showing an arrow cursor at ghost preview coordinates."""
    def __init__(self):
        self.window = None
        self._view = None
        self._hide_timer = None
        self._lock = threading.Lock()

    def _ensure_window(self):
        if not (IS_DARWIN and AppKit):
            return False
        if self.window is not None:
            return True
        try:
            class _CursorView(NSView):
                def drawRect_(self, dirtyRect):
                    NSColor.clearColor().set()
                    NSBezierPath.fillRect_(dirtyRect)
                    # Draw a high-contrast cursor arrow with click indicator ring
                    path = NSBezierPath.bezierPath()
                    # Hotspot tip is at (0, 36) in local 36x36 view
                    path.moveToPoint_(NSPoint(2, 34))
                    path.lineToPoint_(NSPoint(2, 6))
                    path.lineToPoint_(NSPoint(10, 14))
                    path.lineToPoint_(NSPoint(16, 1))
                    path.lineToPoint_(NSPoint(21, 3))
                    path.lineToPoint_(NSPoint(15, 17))
                    path.lineToPoint_(NSPoint(24, 17))
                    path.closePath()
                    
                    # Vibrant neon orange/magenta fill with crisp white border
                    NSColor.colorWithCalibratedRed_green_blue_alpha_(1.0, 0.35, 0.15, 0.95).set()
                    path.fill()
                    NSColor.whiteColor().set()
                    path.setLineWidth_(2.0)
                    path.stroke()

                    # Target dot at the exact tip
                    tip_dot = NSBezierPath.bezierPathWithOvalInRect_(NSMakeRect(0, 32, 4, 4))
                    NSColor.whiteColor().set()
                    tip_dot.fill()

            win = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
                NSMakeRect(0, 0, 36, 36),
                NSWindowStyleMaskBorderless,
                NSBackingStoreBuffered,
                False
            )
            win.setOpaque_(False)
            win.setBackgroundColor_(NSColor.clearColor())
            win.setIgnoresMouseEvents_(True)
            win.setLevel_(AppKit.NSFloatingWindowLevel + 25)
            self._view = _CursorView.alloc().initWithFrame_(NSMakeRect(0, 0, 36, 36))
            win.setContentView_(self._view)
            self.window = win
            return True
        except Exception as e:
            print(f"Failed to create GhostCursorOverlay: {e}")
            return False

    def update_position(self, x, y, auto_hide_seconds=2.5):
        """Move overlay window so its tip aligns with (x, y) in screen coordinates."""
        if not (IS_DARWIN and AppKit):
            return

        def _do_update():
            if not self._ensure_window():
                return
            try:
                screen = NSScreen.mainScreen()
                if not screen:
                    return
                # macOS screen coordinate origin is bottom-left; macro events are top-left
                screen_h = screen.frame().size.height
                # Tip is at (2, 34) relative to view bottom-left
                win_x = x - 2
                win_y = (screen_h - y) - 34
                self.window.setFrameOrigin_(NSPoint(win_x, win_y))
                self.window.orderFrontRegardless()

                # Cancel previous auto-hide timer
                if self._hide_timer:
                    self._hide_timer.cancel()
                if auto_hide_seconds:
                    self._hide_timer = threading.Timer(auto_hide_seconds, self.hide)
                    self._hide_timer.daemon = True
                    self._hide_timer.start()
            except Exception as e:
                print(f"GhostCursorOverlay update_position error: {e}")

        if AppHelper and hasattr(AppHelper, 'callAfter'):
            AppHelper.callAfter(_do_update)
        else:
            _do_update()

    def hide(self):
        def _do_hide():
            if self._hide_timer:
                self._hide_timer.cancel()
                self._hide_timer = None
            if self.window:
                try:
                    self.window.orderOut_(None)
                except Exception:
                    pass

        if AppHelper and hasattr(AppHelper, 'callAfter'):
            AppHelper.callAfter(_do_hide)
        else:
            _do_hide()


def _get_config_path():
    if sys.platform == 'darwin':
        base_dir = os.path.expanduser('~/Library/Application Support/LightningMacro')
    else:
        base_dir = os.path.expanduser('~/.config/LightningMacro')
    try:
        os.makedirs(base_dir, exist_ok=True)
    except Exception:
        pass
    return os.path.join(base_dir, 'config.json')


def _save_last_loaded_file(file_path):
    if not file_path:
        return
    try:
        config_file = _get_config_path()
        config = {}
        if os.path.isfile(config_file):
            try:
                with open(config_file, 'r') as f:
                    config = json.load(f)
            except Exception:
                config = {}
        config['last_loaded_file'] = file_path
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        print(f"Warning: could not save config: {e}")


def _get_last_loaded_file():
    try:
        config_file = _get_config_path()
        if os.path.isfile(config_file):
            with open(config_file, 'r') as f:
                config = json.load(f)
            path = config.get('last_loaded_file')
            if path and os.path.isfile(path):
                return path
    except Exception as e:
        print(f"Warning: could not read config: {e}")
    return None


class LightningMacroAPI:
    def __init__(self):
        self.window = None
        self.events = []
        self.is_recording = False
        self.is_playing = False
        self.is_paused = False
        self._resume_event = threading.Event()
        self._resume_event.set()
        self.is_saved = True
        self.current_file_path = None
        self.start_time = 0
        
        # Settings
        self.loop_count = 1
        self.speed = 1.0
        self.record_movements = True  # Default to True so all mouse motion is logged
        self.always_on_top = True

        # Auto-restore last loaded file if present
        self.load_persisted_macro()

        # Listeners & Controllers
        self.mouse_listener = None
        self.keyboard_listener = None
        self.global_hotkey_listener = None
        
        self.mouse_controller = mouse.Controller()
        self.keyboard_controller = keyboard.Controller()
        self._is_cmd_pressed = False

        # Cached Quartz event source for reliable macOS HID simulation
        self.quartz_source = None
        if IS_DARWIN and Quartz:
            try:
                self.quartz_source = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)
            except Exception as e:
                print(f"Warning: could not create CGEventSource: {e}")

        # Ghost cursor overlay for scrubbing preview
        self.ghost_overlay = GhostCursorOverlay()

    def set_window(self, window):
        self.window = window

    def _eval_js(self, js_code):
        """Asynchronously schedule JS evaluation on the window thread without blocking."""
        if not self.window:
            return
        def _run():
            try:
                self.window.evaluate_js(js_code)
            except Exception:
                pass
        threading.Thread(target=_run, daemon=True).start()

    # --- Javascript Exposed API Methods ---
    def check_permissions(self):
        ax = bool(HIServices.AXIsProcessTrusted()) if (IS_DARWIN and HIServices) else True
        im = bool(Quartz.CGPreflightListenEventAccess()) if (IS_DARWIN and Quartz and hasattr(Quartz, 'CGPreflightListenEventAccess')) else True
        return {
            'accessibility': ax,
            'input_monitoring': im,
            'all_granted': ax and im
        }

    def request_permissions(self):
        if IS_DARWIN:
            if HIServices:
                options = {HIServices.kAXTrustedCheckOptionPrompt: True}
                HIServices.AXIsProcessTrustedWithOptions(options)
            if Quartz and hasattr(Quartz, 'CGRequestListenEventAccess'):
                Quartz.CGRequestListenEventAccess()

    def load_persisted_macro(self):
        last_file = _get_last_loaded_file()
        if last_file:
            try:
                with open(last_file, 'r') as f:
                    self.events = json.load(f)
                self.is_saved = True
                self.current_file_path = last_file
            except Exception as e:
                print(f"Warning: could not auto-load persisted macro from {last_file}: {e}")
                self.events = []
                self.is_saved = True
                self.current_file_path = None

    def get_initial_state(self):
        return {
            'event_count': len(self.events),
            'is_saved': self.is_saved,
            'filename': self.get_current_filename(),
            'filepath': self.current_file_path,
            'duration': self.get_macro_duration()
        }

    def get_event_count(self):
        return len(self.events)

    def get_macro_duration(self):
        if not self.events:
            return 0.0
        return round(float(self.events[-1].get('time', 0.0)), 2)

    def has_unsaved_macro(self):
        return bool(self.events and not self.is_saved)

    def get_current_filename(self):
        return os.path.basename(self.current_file_path) if self.current_file_path else None

    def _update_window_title(self):
        if not self.window:
            return
        filename = self.get_current_filename()
        title = f"Lightning Macro - {filename}" if filename else "Lightning Macro"
        try:
            self.window.set_title(title)
        except Exception:
            pass

    def toggle_record(self):
        if self.is_recording:
            self.stop_recording()
        else:
            if self.is_playing:
                return
            if self.has_unsaved_macro():
                if self.window:
                    try:
                        self.window.show()
                        self.window.restore()
                    except Exception:
                        pass
                filename = self.get_current_filename()
                self._eval_js(f"showSavePromptModal({len(self.events)}, {json.dumps(filename)})")
            else:
                self.start_recording()

    def discard_and_record(self):
        self.start_recording()

    def save_and_record(self):
        if self.save_macro():
            self.start_recording()
        else:
            filename = self.get_current_filename()
            self._eval_js(f"updateUIState('idle', {len(self.events)}, {json.dumps(self.is_saved)}, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")

    def toggle_play(self):
        """Cmd+P / Play action handler:
        - If idle: start playback
        - If playing: pause playback
        - If paused: resume playback
        """
        if self.is_recording:
            return
        if not self.is_playing:
            self.start_playback()
        elif self.is_paused:
            self.resume_playback()
        else:
            self.pause_playback()

    def pause_playback(self):
        """Pause playback while preserving current position."""
        if not self.is_playing or self.is_paused:
            return
        self.is_paused = True
        self._resume_event.clear()
        filename = self.get_current_filename()
        self._eval_js(f"updateUIState('paused', {len(self.events)}, {json.dumps(self.is_saved)}, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")

    def resume_playback(self):
        """Resume playback from paused position."""
        if not self.is_playing or not self.is_paused:
            return
        self.is_paused = False
        self._resume_event.set()
        filename = self.get_current_filename()
        self._eval_js(f"updateUIState('playing', {len(self.events)}, {json.dumps(self.is_saved)}, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")

    def start_playback_from(self, start_index=0):
        if not self.events or self.is_playing or self.is_recording:
            return
        try:
            start_index = max(0, min(int(start_index), len(self.events) - 1))
        except Exception:
            start_index = 0
        self.start_playback(start_index=start_index)

    def preview_position(self, event_index):
        """Move mouse cursor and show ghost overlay at event position without clicking/typing."""
        if not self.events:
            return None
        try:
            idx = max(0, min(int(event_index), len(self.events) - 1))
            ev = self.events[idx]
            target_x = ev.get('x')
            target_y = ev.get('y')

            # If current event doesn't have coordinates, find nearest previous event with coordinates
            if target_x is None or target_y is None:
                for i in range(idx - 1, -1, -1):
                    if 'x' in self.events[i] and 'y' in self.events[i]:
                        target_x = self.events[i]['x']
                        target_y = self.events[i]['y']
                        break

            if target_x is not None and target_y is not None:
                self.ghost_overlay.update_position(target_x, target_y)

            return {
                'index': idx,
                'time': ev.get('time', 0.0),
                'type': ev.get('type', ''),
                'x': target_x,
                'y': target_y,
                'button': ev.get('button'),
                'pressed': ev.get('pressed'),
                'key': ev.get('key')
            }
        except Exception as e:
            print(f"Error in preview_position: {e}")
            return None

    def preview_at_millisecond(self, ms):
        """Show ghost cursor at exact millisecond timestamp by interpolating coordinates without moving real mouse."""
        if not self.events:
            return None
        try:
            target_sec = max(0.0, float(ms) / 1000.0)
            
            # Find the events immediately before and after target_sec
            prev_ev = None
            next_ev = None
            closest_idx = 0
            
            for i, ev in enumerate(self.events):
                t = ev.get('time', 0.0)
                if t <= target_sec:
                    if 'x' in ev and 'y' in ev:
                        prev_ev = ev
                    closest_idx = i
                elif t > target_sec and next_ev is None:
                    if 'x' in ev and 'y' in ev:
                        next_ev = ev
                    break

            # Fallbacks if before or after recorded range
            if prev_ev is None:
                for ev in self.events:
                    if 'x' in ev and 'y' in ev:
                        prev_ev = ev
                        break
            if next_ev is None:
                next_ev = prev_ev

            if not prev_ev:
                return None

            # Linear interpolation between previous and next coordinate
            if prev_ev and next_ev and prev_ev != next_ev:
                t0 = prev_ev.get('time', 0.0)
                t1 = next_ev.get('time', 0.0)
                if t1 > t0:
                    alpha = max(0.0, min(1.0, (target_sec - t0) / (t1 - t0)))
                else:
                    alpha = 0.0
                curr_x = int(round(prev_ev['x'] + (next_ev['x'] - prev_ev['x']) * alpha))
                curr_y = int(round(prev_ev['y'] + (next_ev['y'] - prev_ev['y']) * alpha))
            else:
                curr_x = prev_ev['x']
                curr_y = prev_ev['y']

            # Update ghost overlay representation only; keep user's real cursor free to drag the slider
            self.ghost_overlay.update_position(curr_x, curr_y)

            return {
                'index': closest_idx,
                'time': target_sec,
                'x': curr_x,
                'y': curr_y
            }
        except Exception as e:
            print(f"Error in preview_at_millisecond: {e}")
            return None

    def hide_ghost_cursor(self):
        """Immediately hide ghost overlay window."""
        self.ghost_overlay.hide()

    def get_events(self):
        """Return shallow copies of recorded events for the editor drawer."""
        return self.events

    def trim_macro(self, start_idx, end_idx):
        """Permanently trim macro events to [start_idx, end_idx] and re-zero time offsets."""
        if not self.events:
            return {'success': False, 'message': 'No macro loaded'}
        try:
            start_idx = max(0, int(start_idx))
            end_idx = min(len(self.events) - 1, int(end_idx))
            if start_idx > end_idx:
                return {'success': False, 'message': 'Start index must be before or equal to end index'}
            
            trimmed = self.events[start_idx:end_idx + 1]
            if not trimmed:
                return {'success': False, 'message': 'Cannot trim to an empty macro'}

            base_time = trimmed[0].get('time', 0.0)
            for ev in trimmed:
                ev['time'] = max(0.0, round(ev.get('time', 0.0) - base_time, 4))

            self.events = trimmed
            self.is_saved = False
            filename = self.get_current_filename()
            self._eval_js(f"updateUIState('idle', {len(self.events)}, false, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")
            return {'success': True, 'count': len(self.events), 'duration': self.get_macro_duration()}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def trim_before_index(self, index):
        """Trim away all events before index (keeping [index, len-1]) and re-zero time offsets."""
        if not self.events:
            return {'success': False, 'message': 'No macro loaded'}
        return self.trim_macro(index, len(self.events) - 1)

    def trim_after_index(self, index):
        """Trim away all events after index (keeping [0, index])."""
        if not self.events:
            return {'success': False, 'message': 'No macro loaded'}
        return self.trim_macro(0, index)

    def update_single_event(self, index, updated_data):
        """Edit fields of a specific event permanently."""
        if not self.events:
            return {'success': False, 'message': 'No events in macro'}
        try:
            idx = int(index)
            if idx < 0 or idx >= len(self.events):
                return {'success': False, 'message': 'Index out of range'}
            
            ev = self.events[idx]
            if 'time' in updated_data and updated_data['time'] is not None:
                ev['time'] = max(0.0, float(updated_data['time']))
            if 'x' in updated_data and updated_data['x'] is not None and 'x' in ev:
                ev['x'] = int(updated_data['x'])
            if 'y' in updated_data and updated_data['y'] is not None and 'y' in ev:
                ev['y'] = int(updated_data['y'])
            if 'button' in updated_data and updated_data['button'] is not None and 'button' in ev:
                ev['button'] = str(updated_data['button'])
            if 'pressed' in updated_data and updated_data['pressed'] is not None and 'pressed' in ev:
                ev['pressed'] = bool(updated_data['pressed'])
            if 'key' in updated_data and updated_data['key'] is not None and 'key' in ev:
                ev['key'] = str(updated_data['key'])
            
            # Keep events monotonically sorted by timestamp
            self.events.sort(key=lambda item: item.get('time', 0.0))
            self.is_saved = False
            filename = self.get_current_filename()
            self._eval_js(f"updateUIState('idle', {len(self.events)}, false, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")
            return {'success': True, 'count': len(self.events), 'duration': self.get_macro_duration()}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def delete_single_event(self, index):
        """Delete an individual event permanently."""
        if not self.events:
            return {'success': False, 'message': 'No events'}
        try:
            idx = int(index)
            if idx < 0 or idx >= len(self.events):
                return {'success': False, 'message': 'Index out of range'}
            self.events.pop(idx)
            self.is_saved = False
            filename = self.get_current_filename()
            self._eval_js(f"updateUIState('idle', {len(self.events)}, false, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")
            return {'success': True, 'count': len(self.events), 'duration': self.get_macro_duration()}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def update_settings(self, settings):
        self.loop_count = int(settings.get('loop_count', 1))
        self.speed = float(settings.get('speed', 1.0))
        self.record_movements = bool(settings.get('record_movements', True))
        self.always_on_top = bool(settings.get('always_on_top', True))
        
        if self.window:
            self.window.on_top = self.always_on_top

    def save_macro(self):
        if not self.events:
            return False
        file_path = self.window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename='macro.json',
            file_types=('JSON Files (*.json)', 'All files (*.*)')
        )
        if file_path:
            target = file_path if isinstance(file_path, str) else file_path[0]
            try:
                with open(target, 'w') as f:
                    json.dump(self.events, f, indent=2)
                self.is_saved = True
                self.current_file_path = target
                _save_last_loaded_file(target)
                self._update_window_title()
                filename = self.get_current_filename()
                self._eval_js(f"updateUIState('idle', {len(self.events)}, true, {json.dumps(filename)}, {json.dumps(target)}, {self.get_macro_duration()})")
                return True
            except Exception as e:
                print(f"Error saving macro: {e}")
                return False
        return False

    def load_macro(self):
        file_path = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=('JSON Files (*.json)', 'All files (*.*)')
        )
        if file_path:
            target = file_path if isinstance(file_path, str) else file_path[0]
            try:
                with open(target, 'r') as f:
                    self.events = json.load(f)
                self.is_saved = True
                self.current_file_path = target
                _save_last_loaded_file(target)
                self._update_window_title()
                filename = self.get_current_filename()
                self._eval_js(f"updateUIState('idle', {len(self.events)}, true, {json.dumps(filename)}, {json.dumps(target)}, {self.get_macro_duration()})")
            except Exception as e:
                print(f"Error loading macro: {e}")

    # --- Recording Engine ---
    def start_recording(self):
        if self.is_playing or self.is_recording:
            return

        self.events = []
        self.is_saved = False
        self.current_file_path = None
        self._update_window_title()
        self.is_recording = True
        self.start_time = time.time()
        self._last_move_time = 0
        self._last_move_pos = None
        
        # Update UI state safely
        self._eval_js("updateUIState('recording', 0, false, null, null, 0.0)")

        # Start pynput listeners
        self.mouse_listener = mouse.Listener(
            on_move=self._on_mouse_move,
            on_click=self._on_mouse_click,
            on_scroll=self._on_mouse_scroll
        )
        self.keyboard_listener = keyboard.Listener(
            on_press=self._on_key_press,
            on_release=self._on_key_release
        )

        self.mouse_listener.start()
        self.keyboard_listener.start()

    def stop_recording(self):
        if not self.is_recording:
            return

        self.is_recording = False
        if self.mouse_listener:
            try:
                self.mouse_listener.stop()
            except Exception:
                pass
        if self.keyboard_listener:
            try:
                self.keyboard_listener.stop()
            except Exception:
                pass

        self.is_saved = len(self.events) == 0
        self.current_file_path = None
        self._update_window_title()
        self._eval_js(f"updateUIState('idle', {len(self.events)}, {json.dumps(self.is_saved)}, null, null, {self.get_macro_duration()})")

    # --- Event Handlers ---
    def _elapsed(self):
        return time.time() - self.start_time

    def _record_event(self, event_data):
        if not self.is_recording:
            return
        self.events.append(event_data)

    def _on_mouse_move(self, x, y):
        if not self.record_movements:
            return
        now = self._elapsed()
        # Throttle mouse movement to ~60Hz (0.016s) or when position changed noticeably
        if now - self._last_move_time >= 0.015:
            self._last_move_time = now
            self._last_move_pos = (x, y)
            self._record_event({'type': 'mouse_move', 'time': now, 'x': x, 'y': y})

    def _on_mouse_click(self, x, y, button, pressed):
        # Force log current position immediately before click
        now = self._elapsed()
        self._record_event({
            'type': 'mouse_click',
            'time': now,
            'x': x,
            'y': y,
            'button': str(button),
            'pressed': bool(pressed)
        })

    def _on_mouse_scroll(self, x, y, dx, dy):
        self._record_event({
            'type': 'mouse_scroll',
            'time': self._elapsed(),
            'x': x,
            'y': y,
            'dx': dx,
            'dy': dy
        })

    def _on_key_press(self, key):
        # Ignore global playback trigger hotkey (Cmd+P and secondary F10)
        if key == keyboard.Key.f10:
            return
        if self._is_cmd_pressed and self._key_matches_char(key, 'p'):
            return

        key_str = self._key_to_str(key)
        self._record_event({'type': 'key_press', 'time': self._elapsed(), 'key': key_str})

    def _on_key_release(self, key):
        if key == keyboard.Key.f10:
            return
        if self._is_cmd_pressed and self._key_matches_char(key, 'p'):
            return

        key_str = self._key_to_str(key)
        self._record_event({'type': 'key_release', 'time': self._elapsed(), 'key': key_str})

    def _key_matches_char(self, key, target_char):
        if hasattr(key, 'char') and key.char:
            return key.char.lower() == target_char.lower()
        if hasattr(key, 'vk') and key.vk is not None:
            # macOS virtual keycodes: 15 for 'r', 35 for 'p'
            if target_char.lower() == 'r' and key.vk == 15:
                return True
            if target_char.lower() == 'p' and key.vk == 35:
                return True
        return False

    def _key_to_str(self, key):
        if hasattr(key, 'char') and key.char is not None:
            return key.char
        if hasattr(key, 'vk') and key.vk is not None:
            return f"KeyCode(vk={key.vk})"
        return str(key)

    # --- Playback Engine ---
    def start_playback(self, start_index=0):
        if not self.events or self.is_playing or self.is_recording:
            return

        self.ghost_overlay.hide()
        self.is_playing = True
        self.is_paused = False
        self._resume_event.set()
        filename = self.get_current_filename()
        self._eval_js(f"updateUIState('playing', {len(self.events)}, {json.dumps(self.is_saved)}, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")
        
        threading.Thread(target=self._playback_loop, args=(start_index,), daemon=True).start()

    def stop_playback(self):
        self.is_playing = False
        self.is_paused = False
        self._resume_event.set()  # Unblock thread if paused so loop can terminate cleanly
        self.ghost_overlay.hide()
        filename = self.get_current_filename()
        self._eval_js(f"updateUIState('idle', {len(self.events)}, {json.dumps(self.is_saved)}, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")

    def _play_mouse_move(self, x, y):
        if IS_DARWIN and Quartz:
            try:
                point = Quartz.CGPoint(x, y)
                event = Quartz.CGEventCreateMouseEvent(self.quartz_source, Quartz.kCGEventMouseMoved, point, 0)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
                return
            except Exception as e:
                print(f"Quartz mouse_move failed: {e}")
        self.mouse_controller.position = (x, y)

    def _play_mouse_click(self, x, y, button_str, pressed):
        if IS_DARWIN and Quartz:
            try:
                point = Quartz.CGPoint(x, y)
                btn_lower = button_str.lower()
                if 'right' in btn_lower:
                    event_type = Quartz.kCGEventRightMouseDown if pressed else Quartz.kCGEventRightMouseUp
                    btn = Quartz.kCGMouseButtonRight
                elif 'middle' in btn_lower:
                    event_type = Quartz.kCGEventOtherMouseDown if pressed else Quartz.kCGEventOtherMouseUp
                    btn = Quartz.kCGMouseButtonCenter
                else:
                    event_type = Quartz.kCGEventLeftMouseDown if pressed else Quartz.kCGEventLeftMouseUp
                    btn = Quartz.kCGMouseButtonLeft
                
                event = Quartz.CGEventCreateMouseEvent(self.quartz_source, event_type, point, btn)
                Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
                return
            except Exception as e:
                print(f"Quartz mouse_click failed: {e}")

        self.mouse_controller.position = (x, y)
        btn = mouse.Button.right if 'right' in button_str.lower() else (
            mouse.Button.middle if 'middle' in button_str.lower() else mouse.Button.left
        )
        if pressed:
            self.mouse_controller.press(btn)
        else:
            self.mouse_controller.release(btn)

    def _playback_loop(self, initial_start_index=0):
        loops_performed = 0
        total_events = len(self.events)
        
        while self.is_playing:
            # First loop starts at initial_start_index; subsequent repeat loops start from index 0
            start_i = initial_start_index if loops_performed == 0 else 0
            last_time = self.events[start_i]['time'] if (self.events and start_i < total_events) else 0

            # If starting partway through, position cursor without clicking
            if loops_performed == 0 and start_i > 0 and start_i < total_events:
                ev_init = self.events[start_i]
                if 'x' in ev_init and 'y' in ev_init:
                    self._play_mouse_move(ev_init['x'], ev_init['y'])

            for idx in range(start_i, total_events):
                if not self.is_playing:
                    break

                # If playback was paused, wait here until resumed or stopped
                while self.is_playing and self.is_paused:
                    self._resume_event.wait(timeout=0.1)

                if not self.is_playing:
                    break

                event = self.events[idx]
                delay = (event['time'] - last_time) / max(0.1, self.speed)
                if delay > 0:
                    # Sleep in small slices to respond promptly to pause or stop requests
                    elapsed_delay = 0.0
                    slice_step = 0.02
                    while elapsed_delay < delay and self.is_playing:
                        if self.is_paused:
                            while self.is_playing and self.is_paused:
                                self._resume_event.wait(timeout=0.1)
                            if not self.is_playing:
                                break
                        chunk = min(slice_step, delay - elapsed_delay)
                        time.sleep(chunk)
                        elapsed_delay += chunk

                if not self.is_playing:
                    break

                last_time = event['time']

                # Update progress in UI every 20 events or on clicks
                if idx % 20 == 0 or event['type'] == 'mouse_click':
                    if self.loop_count > 1:
                        loop_str = f"Loop {loops_performed + 1}/{self.loop_count}"
                    elif self.loop_count == 0:
                        loop_str = f"Loop {loops_performed + 1}"
                    else:
                        loop_str = ""
                    if self.loop_count > 0:
                        speed_factor = max(0.1, self.speed)
                        single_loop_time = (self.events[-1]['time'] if self.events else 0.0) / speed_factor
                        current_event_time = event['time'] / speed_factor
                        loops_remaining = max(0, self.loop_count - loops_performed - 1)
                        remaining_in_curr_loop = max(0.0, single_loop_time - current_event_time)
                        total_remaining_secs = (loops_remaining * single_loop_time) + remaining_in_curr_loop
                        rem_arg = f"{total_remaining_secs:.2f}"
                    else:
                        rem_arg = "null"
                    self._eval_js(f"updatePlaybackProgress({idx + 1}, {total_events}, '{loop_str}', {rem_arg})")

                try:
                    etype = event['type']
                    if etype == 'mouse_move':
                        self._play_mouse_move(event['x'], event['y'])

                    elif etype == 'mouse_click':
                        self._play_mouse_click(event['x'], event['y'], event['button'], event['pressed'])

                    elif etype == 'mouse_scroll':
                        self.mouse_controller.position = (event['x'], event['y'])
                        self.mouse_controller.scroll(event['dx'], event['dy'])

                    elif etype in ('key_press', 'key_release'):
                        k = self._str_to_key(event['key'])
                        if k is not None:
                            if etype == 'key_press':
                                self.keyboard_controller.press(k)
                            else:
                                self.keyboard_controller.release(k)
                except Exception as e:
                    print(f"Playback error on event {event}: {e}")

            loops_performed += 1
            if self.loop_count > 0 and loops_performed >= self.loop_count:
                break

        self.is_playing = False
        filename = self.get_current_filename()
        self._eval_js(f"updateUIState('idle', {len(self.events)}, {json.dumps(self.is_saved)}, {json.dumps(filename)}, {json.dumps(self.current_file_path)}, {self.get_macro_duration()})")

    def _str_to_key(self, k_str):
        if not k_str:
            return None
        if k_str.startswith("Key."):
            attr = k_str.split(".")[1]
            return getattr(keyboard.Key, attr, None)
        import re
        m_vk = re.match(r"^(?:<(\d+)>|KeyCode\(vk=(\d+)\))$", k_str)
        if m_vk:
            vk_code = int(m_vk.group(1) or m_vk.group(2))
            return keyboard.KeyCode.from_vk(vk_code)
        return keyboard.KeyCode.from_char(k_str)

    # --- Global Hotkey Listener (Cmd+P: Play/Stop) ---
    def start_global_hotkeys(self):
        def on_press(key):
            # Track Command / Meta key status
            if key in (keyboard.Key.cmd, keyboard.Key.cmd_l, keyboard.Key.cmd_r):
                self._is_cmd_pressed = True
                return

            # Check Cmd+P (Play/Stop)
            if self._is_cmd_pressed and self._key_matches_char(key, 'p'):
                self.toggle_play()
                return

            # Retain F10 as secondary shortcut for Play/Stop
            if key == keyboard.Key.f10:
                self.toggle_play()

        def on_release(key):
            if key in (keyboard.Key.cmd, keyboard.Key.cmd_l, keyboard.Key.cmd_r):
                self._is_cmd_pressed = False

        self.global_hotkey_listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        self.global_hotkey_listener.start()


def get_html_path():
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'index.html')
    return os.path.join(os.path.dirname(__file__), 'index.html')


if __name__ == '__main__':
    api = LightningMacroAPI()
    
    filename = api.get_current_filename()
    title = f"Lightning Macro - {filename}" if filename else "Lightning Macro"
    window = webview.create_window(
        title,
        url=get_html_path(),
        js_api=api,
        width=460,
        height=700,
        resizable=True,
        on_top=True
    )
    
    api.set_window(window)
    api.start_global_hotkeys()
    
    webview.start(debug=False)
