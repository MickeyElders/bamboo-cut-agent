# -*- coding: utf-8 -*-

import os, gc
import json
import time
from libs.PlatTasks import DetectionApp
from libs.PipeLine import PipeLine
from libs.Utils import *

if hasattr(time, "ticks_ms") and hasattr(time, "ticks_diff"):
    _ticks_ms = time.ticks_ms
    _ticks_diff = time.ticks_diff
else:
    _ticks_ms = lambda: int(time.time() * 1000)
    _ticks_diff = lambda now, last: now - last

# Set display mode: options are 'hdmi', 'lcd', 'lt9611', 'st7701', 'hx8399'
# 'hdmi' defaults to 'lt9611' (1920x1080); 'lcd' defaults to 'st7701' (800x480)
display_mode = "lt9611"

# Define the input size for the RGB888P video frames
rgb888p_size = [1280, 720]

# Sensor indices to try (valid ids are 0/1 on this SDK).
SENSOR_IDS_TO_TRY = [0, 1]

# Set root directory path for model and config
root_path = "/sdcard/mp_deployment_source/"
KMODEL_PATH_OVERRIDE = "/sdcard/mp_deployment_source/best_AnchorBaseDet_can2_5_s_20251211132427.kmodel"
KMODEL_AUTO_FIX_APPLEDOUBLE = True  # auto-fix "._xxxx" (macOS sidecar) if possible

# Load deployment configuration
deploy_conf = read_json(root_path + "/deploy_config.json")
conf_kmodel = None
try:
    conf_kmodel = deploy_conf.get("kmodel_path")
except Exception:
    conf_kmodel = None

def _path_exists(p):
    try:
        os.stat(p)
        return True
    except Exception:
        return False

def _path_size(p):
    try:
        return int(os.stat(p)[6])
    except Exception:
        return -1

def _resolve_kmodel_path(p):
    if not p:
        return p
    p = str(p).replace("\\", "/")

    # Common Windows-ish input: "sdcard/xxx"
    if p.startswith("sdcard/"):
        p = "/" + p

    # Auto-fix macOS "AppleDouble" sidecar file: "._filename"
    base = p.split("/")[-1]
    if KMODEL_AUTO_FIX_APPLEDOUBLE and base.startswith("._"):
        dir_part = p.rsplit("/", 1)[0] if "/" in p else ""
        candidates = []
        candidates.append(dir_part + "/" + base[1:])  # drop leading '.' -> "_xxx" (common)
        candidates.append(dir_part + "/" + base[2:])  # drop "._" -> "xxx"
        for c in candidates:
            if _path_exists(c) and _path_size(c) > 4096:
                return c

    return p

if KMODEL_PATH_OVERRIDE:
    kmodel_path = _resolve_kmodel_path(KMODEL_PATH_OVERRIDE)
elif conf_kmodel:
    kmodel_path = _resolve_kmodel_path(root_path + str(conf_kmodel).lstrip("/").lstrip("\\"))
else:
    raise Exception("kmodel_path not specified: set KMODEL_PATH_OVERRIDE or deploy_config.json kmodel_path")

if not _path_exists(kmodel_path):
    try:
        files = [f for f in os.listdir(root_path) if str(f).endswith(".kmodel")]
    except Exception:
        files = []
    raise Exception("Kmodel not found: %s; available .kmodel in %s: %s" % (kmodel_path, root_path, files))

if _path_size(kmodel_path) <= 4096:
    raise Exception("Kmodel file too small (%d bytes): %s (可能选到了 macOS 的 '._xxx' 旁路文件/拷贝不完整)" % (_path_size(kmodel_path), kmodel_path))
labels = deploy_conf["categories"]                                # Label list
confidence_threshold = deploy_conf["confidence_threshold"]        # Confidence threshold
nms_threshold = deploy_conf["nms_threshold"]                      # NMS threshold
model_input_size = deploy_conf["img_size"]                        # Model input size
nms_option = deploy_conf["nms_option"]                            # NMS strategy
model_type = deploy_conf["model_type"]                            # Detection model type
anchors = []
if model_type == "AnchorBaseDet":
    anchors = deploy_conf["anchors"][0] + deploy_conf["anchors"][1] + deploy_conf["anchors"][2]

# Inference configuration
inference_mode = "video"                                          # Inference mode: 'video'
debug_mode = 0                                                    # Debug mode flag

# ------------------------ Control/status transport --------------------------
# HDMI carries video only.
# Detection metadata, cut requests, and cut-line config are exchanged over
# a serial transport exposed on GPIO, preferably UART.
TRANSPORT_KIND = "uart"          # "uart" or "usb_cdc"
TRANSPORT_BAUDRATE = 115200
TRANSPORT_SEND_ENABLE = True
TRANSPORT_SEND_MIN_INTERVAL_MS = 100  # 10 Hz
TRANSPORT_USE_STDOUT_FALLBACK = False
UART_PORT = 1                    # adjust to the board UART you wired
UART_TX_PIN = None               # set explicit TX pin if your board requires it
UART_RX_PIN = None               # set explicit RX pin if your board requires it

_transport = None
_transport_rx_buffer = ""

def _init_transport():
    if TRANSPORT_KIND == "uart":
        try:
            from machine import UART
            kwargs = {}
            if UART_TX_PIN is not None:
                kwargs["tx"] = UART_TX_PIN
            if UART_RX_PIN is not None:
                kwargs["rx"] = UART_RX_PIN
            return UART(UART_PORT, TRANSPORT_BAUDRATE, **kwargs)
        except Exception:
            return None

    if TRANSPORT_KIND == "usb_cdc":
        try:
            import usb_cdc
            return usb_cdc.data if hasattr(usb_cdc, "data") else usb_cdc
        except Exception:
            return None

    return None

_transport = _init_transport()

def _transport_write_line(s):
    if not TRANSPORT_SEND_ENABLE:
        return
    try:
        if _transport is not None:
            _transport.write(s.encode())
        elif TRANSPORT_USE_STDOUT_FALLBACK:
            print(s, end="")
    except Exception:
        pass

def _transport_read_available():
    if _transport is None:
        return ""
    try:
        any_fn = getattr(_transport, "any", None)
        if callable(any_fn):
            size = int(any_fn())
            if size <= 0:
                return ""
            raw = _transport.read(size)
        else:
            return ""
        if not raw:
            return ""
        if isinstance(raw, bytes):
            return raw.decode(errors="ignore")
        return str(raw)
    except Exception:
        return ""

# Create and initialize the video/display pipeline with sensor auto-detect
def _create_pipeline():
    last_exc = None
    # First, try default create() with no sensor_id (let SDK auto-select).
    try:
        try:
            print("[Cam] try default sensor (auto)")
        except Exception:
            pass
        pl = PipeLine(rgb888p_size=rgb888p_size, display_mode=display_mode)
        pl.create()
        try:
            print("[Cam] sensor ok: auto")
        except Exception:
            pass
        return pl, None
    except Exception as exc:
        last_exc = exc
        try:
            if "pl" in locals() and hasattr(pl, "destroy"):
                pl.destroy()
        except Exception:
            pass

    for sid in SENSOR_IDS_TO_TRY:
        try:
            try:
                print("[Cam] try sensor id:", sid)
            except Exception:
                pass
            try:
                pl = PipeLine(rgb888p_size=rgb888p_size, display_mode=display_mode)
            except TypeError:
                pl = PipeLine(rgb888p_size=rgb888p_size, display_mode=display_mode)
                if hasattr(pl, "set_sensor_id"):
                    pl.set_sensor_id(sid)
                elif hasattr(pl, "set_cam_id"):
                    pl.set_cam_id(sid)
                elif hasattr(pl, "set_sensor"):
                    pl.set_sensor(sid)
            try:
                pl.create(sensor_id=sid)
            except TypeError:
                pl.create()
            try:
                print("[Cam] sensor ok:", sid)
            except Exception:
                pass
            return pl, sid
        except Exception as exc:
            last_exc = exc
            try:
                print("[Cam] sensor failed:", sid, "err:", exc)
            except Exception:
                pass
            try:
                if "pl" in locals() and hasattr(pl, "destroy"):
                    pl.destroy()
            except Exception:
                pass
    if last_exc is not None:
        raise RuntimeError("Camera sensor not found; tried %s; last_err=%s" % (SENSOR_IDS_TO_TRY, last_exc))
    raise RuntimeError("Camera sensor not found")

pl, _sensor_id = _create_pipeline()
display_size = pl.get_display_size()

# Initialize object detection application
det_app = DetectionApp(inference_mode,kmodel_path,labels,model_input_size,anchors,model_type,confidence_threshold,nms_threshold,rgb888p_size,display_size,debug_mode=debug_mode)

# Configure preprocessing for the model
det_app.config_preprocess()

# -------------------------- Cut-line decision config -------------------------
# CanMV is only responsible for:
# 1) object detection
# 2) checking whether the selected target reaches the configured cut line
# 3) reporting cut_request over USB JSON
# Motor/feed/cutter execution is handled on the Raspberry Pi side.
TRIGGER_ENABLE = False
TRIGGER_PIN = 32                 # TODO: set to your board's GPIO number
TRIGGER_ACTIVE_LEVEL = 1         # 1=HIGH active, 0=LOW active
TRIGGER_INACTIVE_LEVEL = 0 if TRIGGER_ACTIVE_LEVEL else 1
TRIGGER_TARGET_LABEL = None      # e.g. "person" or None for any class
TRIGGER_TARGET_ID = None         # e.g. 0 or None; takes precedence over label
TRIGGER_ROI_CENTER = None        # None -> screen center; or (x, y) in display coords
TRIGGER_ROI_HALF_SIZE = (30, 30) # (half_w, half_h) in pixels
TRIGGER_USE_CENTER_LINE = True   # True -> use vertical center line "strip" as ROI
TRIGGER_DECISION_ENABLE = True   # keep cut-line judgement active even if GPIO output is disabled
TRIGGER_LINE_TOLERANCE_PX = 20   # center line tolerance (+/- pixels)
TRIGGER_LINE_COLOR = (255, 0, 0) # red
TRIGGER_LINE_THICKNESS = 2
TRIGGER_LINE_USE_BBOX_INTERSECT = True  # True -> bbox crosses center line triggers (recommended)
TRIGGER_MIN_HITS = 3             # require N consecutive frames inside ROI
TRIGGER_HOLD_MS = 200            # keep output active for at least this long

OSD_INFO_ENABLE = False
OSD_INFO_COLOR = (0, 255, 0)     # green
OSD_INFO_WARN_COLOR = (255, 0, 0)
OSD_INFO_HINT_COLOR = (255, 255, 0)  # yellow
OSD_INFO_XY = (8, 8)
OSD_INFO_LINE_H = 18
OSD_INFO_UPDATE_MS = 250
OSD_SHOW_CENTER_GUIDE = False
OSD_DRAW_CUT_ZONE = True
OSD_DRAW_TARGET_MARK = True
OSD_TARGET_MARK_SIZE = 10
OSD_TARGET_COLOR = (0, 255, 255)       # cyan
OSD_TARGET_HIT_COLOR = (255, 0, 255)   # magenta
OSD_CUTLINE_ACTIVE_COLOR = (0, 255, 0) # green when overlapping/cutting

CUT_LINE_RATIO_X = 0.5
CUT_TOLERANCE_RATIO_X = 0.015

try:
    from machine import Pin  # CanMV/MicroPython style
except Exception:
    Pin = None

def _init_trigger_pin():
    if not TRIGGER_ENABLE or Pin is None:
        return None
    pin = Pin(TRIGGER_PIN, Pin.OUT)
    pin.value(TRIGGER_INACTIVE_LEVEL)
    return pin

def _pick_best_det(res):
    """
    Expected res format (most common):
      [[class_id, score, x1, y1, x2, y2], ...]  (coords in display space)
    If your res format differs, adjust this function only.
    """
    if not res:
        return None

    def _to_int(v):
        try:
            return int(v)
        except Exception:
            return None

    def _to_float(v):
        try:
            return float(v)
        except Exception:
            return None

    def _unpack_det(det):
        if isinstance(det, dict):
            class_id = det.get("class_id", det.get("class", det.get("id")))
            score = det.get("score", det.get("conf", det.get("confidence")))
            bbox = det.get("bbox", det.get("box", det.get("rect")))
            if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                x1, y1, x2, y2 = bbox[0], bbox[1], bbox[2], bbox[3]
                return class_id, score, x1, y1, x2, y2
            return None

        if isinstance(det, (list, tuple)) and len(det) >= 6:
            return det[0], det[1], det[2], det[3], det[4], det[5]

        return None

    best = None
    best_score = -1.0
    for det in res:
        unpacked = _unpack_det(det)
        if not unpacked:
            continue
        class_id, score, x1, y1, x2, y2 = unpacked

        class_id_i = _to_int(class_id)
        score_f = _to_float(score)
        x1_f = _to_float(x1)
        y1_f = _to_float(y1)
        x2_f = _to_float(x2)
        y2_f = _to_float(y2)
        if class_id_i is None or score_f is None or None in (x1_f, y1_f, x2_f, y2_f):
            continue

        if TRIGGER_TARGET_ID is not None and class_id_i != TRIGGER_TARGET_ID:
            continue
        if TRIGGER_TARGET_ID is None and TRIGGER_TARGET_LABEL is not None:
            try:
                if labels[class_id_i] != TRIGGER_TARGET_LABEL:
                    continue
            except Exception:
                continue

        if score_f > best_score:
            best_score = score_f
            best = (class_id_i, score_f, x1_f, y1_f, x2_f, y2_f)

    return best

def _center_in_roi(cx, cy, roi_center, roi_half_size):
    rx, ry = roi_center
    half_w, half_h = roi_half_size
    return (rx - half_w) <= cx <= (rx + half_w) and (ry - half_h) <= cy <= (ry + half_h)

def _draw_center_line_hint(osd_img, display_size):
    if osd_img is None or not hasattr(osd_img, "draw_line"):
        return
    x = display_size[0] // 2
    y0 = 0
    y1 = display_size[1] - 1
    try:
        osd_img.draw_line(x, y0, x, y1, color=TRIGGER_LINE_COLOR, thickness=TRIGGER_LINE_THICKNESS)
    except Exception:
        try:
            osd_img.draw_line(x, y0, x, y1, 0xFF0000, TRIGGER_LINE_THICKNESS)
        except Exception:
            pass

def _draw_cut_zone_hint(osd_img, display_size, line_x, tol_px):
    if osd_img is None or not hasattr(osd_img, "draw_line"):
        return
    if line_x is None:
        return
    try:
        tol_px = int(tol_px)
    except Exception:
        return
    if tol_px <= 0:
        return

    y0 = 0
    y1 = display_size[1] - 1
    x1 = int(line_x - tol_px)
    x2 = int(line_x + tol_px)
    try:
        osd_img.draw_line(x1, y0, x1, y1, color=OSD_INFO_HINT_COLOR, thickness=1)
        osd_img.draw_line(x2, y0, x2, y1, color=OSD_INFO_HINT_COLOR, thickness=1)
    except Exception:
        try:
            osd_img.draw_line(x1, y0, x1, y1, 0xFFFF00, 1)
            osd_img.draw_line(x2, y0, x2, y1, 0xFFFF00, 1)
        except Exception:
            pass

def _draw_cross(osd_img, x, y, size, color):
    if osd_img is None or not hasattr(osd_img, "draw_line"):
        return
    try:
        x = int(x)
        y = int(y)
        size = int(size)
    except Exception:
        return
    if size <= 0:
        return
    try:
        osd_img.draw_line(x - size, y, x + size, y, color=color, thickness=2)
        osd_img.draw_line(x, y - size, x, y + size, color=color, thickness=2)
    except Exception:
        try:
            osd_img.draw_line(x - size, y, x + size, y, 0x00FFFF, 2)
            osd_img.draw_line(x, y - size, x, y + size, 0x00FFFF, 2)
        except Exception:
            pass

def _draw_text(osd_img, x, y, s, color):
    if osd_img is None:
        return
    s = str(s)
    try:
        if hasattr(osd_img, "draw_string"):
            osd_img.draw_string(int(x), int(y), s, color=color)
            return
    except Exception:
        pass

    try:
        if hasattr(osd_img, "draw_text"):
            osd_img.draw_text(int(x), int(y), s, color=color)
            return
    except Exception:
        pass

    try:
        if hasattr(osd_img, "draw_string"):
            osd_img.draw_string(int(x), int(y), s, color)
            return
    except Exception:
        pass

def _fmt_ms(ms):
    if ms is None:
        return "-"
    try:
        ms = int(ms)
    except Exception:
        return "-"
    if ms < 1000:
        return "%dms" % ms
    return "%.2fs" % (ms / 1000.0)

def _clamp(value, minimum, maximum):
    if value < minimum:
        return minimum
    if value > maximum:
        return maximum
    return value

def _current_cut_config():
    return {
        "line_ratio_x": round(float(CUT_LINE_RATIO_X), 4),
        "tolerance_ratio_x": round(float(CUT_TOLERANCE_RATIO_X), 4),
        "show_guide": bool(OSD_SHOW_CENTER_GUIDE),
        "min_hits": int(TRIGGER_MIN_HITS),
        "hold_ms": int(TRIGGER_HOLD_MS),
    }

def _apply_cut_config(payload):
    global CUT_LINE_RATIO_X, CUT_TOLERANCE_RATIO_X, OSD_SHOW_CENTER_GUIDE, TRIGGER_MIN_HITS, TRIGGER_HOLD_MS
    if not isinstance(payload, dict):
        return

    try:
        if "line_ratio_x" in payload and payload["line_ratio_x"] is not None:
            CUT_LINE_RATIO_X = _clamp(float(payload["line_ratio_x"]), 0.0, 1.0)
    except Exception:
        pass

    try:
        if "tolerance_ratio_x" in payload and payload["tolerance_ratio_x"] is not None:
            CUT_TOLERANCE_RATIO_X = _clamp(float(payload["tolerance_ratio_x"]), 0.0, 0.25)
    except Exception:
        pass

    try:
        if "show_guide" in payload and payload["show_guide"] is not None:
            OSD_SHOW_CENTER_GUIDE = bool(payload["show_guide"])
    except Exception:
        pass

    try:
        if "min_hits" in payload and payload["min_hits"] is not None:
            TRIGGER_MIN_HITS = int(_clamp(int(payload["min_hits"]), 1, 20))
    except Exception:
        pass

    try:
        if "hold_ms" in payload and payload["hold_ms"] is not None:
            TRIGGER_HOLD_MS = int(_clamp(int(payload["hold_ms"]), 0, 5000))
    except Exception:
        pass

def _process_usb_commands():
    global _usb_rx_buffer
    chunk = _usb_read_available()
    if not chunk:
        return

    _usb_rx_buffer += chunk
    while "\n" in _usb_rx_buffer:
        line, _usb_rx_buffer = _usb_rx_buffer.split("\n", 1)
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        if data.get("type") == "cut_config":
            _apply_cut_config(data.get("payload"))

trigger_pin = _init_trigger_pin()
trigger_active = False
trigger_hits = 0
trigger_last_on_ms = 0
trigger_prev_active = False

_fps = 0.0
_fps_frames = 0
_fps_last_ms = _ticks_ms()
_start_ms = _fps_last_ms
_info_last_ms = -10000000
_info_lines = []
_loop_ema_ms = None
_infer_ema_ms = None
_status_temp_c = None

STATUS_EMA_ALPHA = 0.2

def _ema(prev, value, alpha=STATUS_EMA_ALPHA):
    try:
        value = float(value)
    except Exception:
        return prev
    if prev is None:
        return value
    return (float(prev) * (1.0 - alpha)) + (value * alpha)

def _clamp_percent(value):
    if value is None:
        return None
    try:
        value = float(value)
    except Exception:
        return None
    if value < 0.0:
        value = 0.0
    if value > 100.0:
        value = 100.0
    return round(value, 1)

def _get_memory_percent():
    try:
        if hasattr(gc, "mem_alloc") and hasattr(gc, "mem_free"):
            used = float(gc.mem_alloc())
            free = float(gc.mem_free())
            total = used + free
            if total > 0:
                return round((used * 100.0) / total, 1)
    except Exception:
        pass
    return None

def _read_temperature_c():
    candidates = []
    try:
        import machine
        candidates.extend([
            getattr(machine, "temperature", None),
            getattr(machine, "temp", None),
            getattr(machine, "get_temperature", None),
            getattr(machine, "read_temperature", None),
        ])
    except Exception:
        pass

    for candidate in candidates:
        try:
            value = candidate() if callable(candidate) else candidate
            if value is None:
                continue
            return round(float(value), 1)
        except Exception:
            pass
    return None

def _build_canmv_status():
    cpu_percent = None
    kpu_percent = None

    try:
        if _loop_ema_ms is not None and float(_loop_ema_ms) > 0 and _infer_ema_ms is not None:
            kpu_percent = _clamp_percent((float(_infer_ema_ms) / float(_loop_ema_ms)) * 100.0)
            cpu_percent = _clamp_percent(((float(_loop_ema_ms) - float(_infer_ema_ms)) / float(_loop_ema_ms)) * 100.0)
    except Exception:
        cpu_percent = None
        kpu_percent = None

    return {
        "cpu_percent": cpu_percent,
        "kpu_percent": kpu_percent,
        "memory_percent": _get_memory_percent(),
        "temperature_c": _status_temp_c,
    }

def _split_res(res):
    """
    Returns (res_for_draw, det_list_for_trigger).
    Keep res_for_draw in the original structure whenever possible, because
    draw_result() may expect a specific type (e.g. dict).
    """
    if res is None:
        return res, []

    if isinstance(res, (list, tuple)):
        return res, res

    if isinstance(res, dict):
        for k in ("dets", "detections", "results", "objects"):
            v = res.get(k)
            if isinstance(v, (list, tuple)):
                return res, v

        boxes = res.get("boxes")
        scores = res.get("scores")
        class_ids = res.get("class_ids", res.get("classes", res.get("labels")))
        if isinstance(boxes, (list, tuple)) and isinstance(scores, (list, tuple)) and isinstance(class_ids, (list, tuple)):
            dets = []
            for cid, sc, box in zip(class_ids, scores, boxes):
                if isinstance(box, (list, tuple)) and len(box) >= 4:
                    dets.append([cid, sc, box[0], box[1], box[2], box[3]])
            return res, dets

        return res, []

    try:
        materialized = list(res)
        return materialized, materialized
    except Exception:
        return res, []

# Build detection payload for USB output
def _iter_dets(dets):
    for det in dets:
        if isinstance(det, dict):
            class_id = det.get("class_id", det.get("class", det.get("id")))
            score = det.get("score", det.get("conf", det.get("confidence")))
            bbox = det.get("bbox", det.get("box", det.get("rect")))
            if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                yield class_id, score, bbox[0], bbox[1], bbox[2], bbox[3]
            continue

        if isinstance(det, (list, tuple)) and len(det) >= 6:
            yield det[0], det[1], det[2], det[3], det[4], det[5]

def _build_detection_list(dets):
    out = []
    for class_id, score, x1, y1, x2, y2 in _iter_dets(dets):
        try:
            cid = int(class_id)
            sc = float(score)
            x1f = float(x1)
            y1f = float(y1)
            x2f = float(x2)
            y2f = float(y2)
        except Exception:
            continue

        x = int(x1f if x1f <= x2f else x2f)
        y = int(y1f if y1f <= y2f else y2f)
        w = int(abs(x2f - x1f))
        h = int(abs(y2f - y1f))
        label = None
        try:
            if labels and cid < len(labels):
                label = labels[cid]
        except Exception:
            label = None
        if label is None:
            label = str(cid)

        out.append({"label": label, "score": sc, "x": x, "y": y, "w": w, "h": h})
    return out

# Main loop: capture, run inference, display results
try:
    _usb_last_ms = _ticks_ms()
    while True:
        with ScopedTiming("total", 1):
            _loop_begin_ms = _ticks_ms()
            _status_temp_c = _read_temperature_c()
            _process_usb_commands()

            img = pl.get_frame()                          # Capture current frame

            _infer_begin_ms = _ticks_ms()
            res = det_app.run(img)                        # Run inference
            _infer_ms = _ticks_diff(_ticks_ms(), _infer_begin_ms)
            res_draw, dets = _split_res(res)
            now_ms = _ticks_ms()

            # FPS calc (lightweight)
            _fps_frames += 1
            dt_ms = _ticks_diff(now_ms, _fps_last_ms)
            if dt_ms >= 500:
                _fps = (_fps_frames * 1000.0) / float(dt_ms)
                _fps_frames = 0
                _fps_last_ms = now_ms

            # Cut-line decision using CanMV-native detection coordinates.
            best_det = None
            line_x = None
            line_tol_px = None
            best_center = None
            overlap_now = False
            trigger_rise = False
            if TRIGGER_DECISION_ENABLE:
                if TRIGGER_USE_CENTER_LINE:
                    line_x = int(float(display_size[0]) * float(CUT_LINE_RATIO_X))
                    line_tol_px = max(1, int(float(display_size[0]) * float(CUT_TOLERANCE_RATIO_X)))
                    roi_center = (line_x, display_size[1] // 2)
                    roi_half_size = (line_tol_px, display_size[1] // 2)
                else:
                    roi_center = TRIGGER_ROI_CENTER or (display_size[0] // 2, display_size[1] // 2)
                    roi_half_size = TRIGGER_ROI_HALF_SIZE
                best_det = _pick_best_det(dets)
                inside = False
                if best_det is not None:
                    _, score, x1, y1, x2, y2 = best_det
                    cx = int((x1 + x2) / 2)
                    cy = int((y1 + y2) / 2)
                    best_center = (cx, cy)
                    if TRIGGER_USE_CENTER_LINE and TRIGGER_LINE_USE_BBOX_INTERSECT:
                        inside = (x1 <= line_x <= x2)
                    else:
                        inside = _center_in_roi(cx, cy, roi_center, roi_half_size)
                overlap_now = bool(inside)

                if inside:
                    trigger_hits = min(TRIGGER_MIN_HITS, trigger_hits + 1)
                    if trigger_hits >= TRIGGER_MIN_HITS:
                        trigger_active = True
                        trigger_last_on_ms = now_ms
                else:
                    trigger_hits = 0
                    if trigger_active and _ticks_diff(now_ms, trigger_last_on_ms) >= TRIGGER_HOLD_MS:
                        trigger_active = False

                if trigger_pin is not None:
                    trigger_pin.value(TRIGGER_ACTIVE_LEVEL if trigger_active else TRIGGER_INACTIVE_LEVEL)
                trigger_rise = trigger_active and (not trigger_prev_active)
            trigger_prev_active = trigger_active

            # USB CDC output (AI detections + cut decision)
            if USB_SEND_ENABLE and _ticks_diff(now_ms, _usb_last_ms) >= USB_SEND_MIN_INTERVAL_MS:
                payload = {
                    "timestamp": time.time(),
                    "fps": _fps,
                    "detections": _build_detection_list(dets),
                    "canmv_status": _build_canmv_status(),
                    "cut_request": bool(trigger_rise),
                    "cut_config": _current_cut_config(),
                }
                _usb_write_line(json.dumps(payload) + "\n")
                _usb_last_ms = now_ms

            det_app.draw_result(pl.osd_img, res_draw)     # Draw detection results
            if TRIGGER_USE_CENTER_LINE and OSD_SHOW_CENTER_GUIDE:
                _draw_center_line_hint(pl.osd_img, display_size)
                if OSD_DRAW_CUT_ZONE:
                    _draw_cut_zone_hint(
                        pl.osd_img,
                        display_size,
                        line_x if line_x is not None else int(float(display_size[0]) * float(CUT_LINE_RATIO_X)),
                        line_tol_px if line_tol_px is not None else max(1, int(float(display_size[0]) * float(CUT_TOLERANCE_RATIO_X))),
                    )
                if overlap_now:
                    try:
                        x = line_x if line_x is not None else int(float(display_size[0]) * float(CUT_LINE_RATIO_X))
                        pl.osd_img.draw_line(x, 0, x, display_size[1] - 1, color=OSD_CUTLINE_ACTIVE_COLOR, thickness=TRIGGER_LINE_THICKNESS + 1)
                    except Exception:
                        pass

            if OSD_DRAW_TARGET_MARK and best_center is not None:
                cx, cy = best_center
                _draw_cross(pl.osd_img, cx, cy, OSD_TARGET_MARK_SIZE, OSD_TARGET_HIT_COLOR if overlap_now else OSD_TARGET_COLOR)

            # On-screen info
            if OSD_INFO_ENABLE and _ticks_diff(now_ms, _info_last_ms) >= OSD_INFO_UPDATE_MS:
                det_count = 0
                try:
                    det_count = len(dets)
                except Exception:
                    det_count = 0

                best_s = "-"
                if best_det is not None:
                    try:
                        cid, sc, x1, y1, x2, y2 = best_det
                        name = labels[int(cid)] if labels and int(cid) < len(labels) else str(cid)
                        best_s = "%s %.2f" % (name, float(sc))
                        if line_x is not None:
                            cx = int((x1 + x2) / 2)
                            best_s += " dx=%d" % int(cx - line_x)
                    except Exception:
                        pass

                uptime_ms = _ticks_diff(now_ms, _start_ms)
                mem_free = None
                try:
                    if hasattr(gc, "mem_free"):
                        mem_free = gc.mem_free()
                except Exception:
                    mem_free = None

                _info_lines = [
                    "FPS: %.1f  Dets: %d  Up: %s" % (_fps, det_count, _fmt_ms(uptime_ms)),
                    "CutReq: %s  Hits: %d  Overlap: %s" % (
                        "ON" if trigger_rise else "OFF",
                        trigger_hits,
                        "YES" if overlap_now else "NO",
                    ),
                    "Best: %s" % best_s,
                ]
                if mem_free is not None:
                    _info_lines.append("MemFree: %d" % int(mem_free))
                _info_last_ms = now_ms

            if OSD_INFO_ENABLE and _info_lines:
                x0, y0 = OSD_INFO_XY
                for idx, line in enumerate(_info_lines):
                    color = OSD_INFO_COLOR
                    if "CutReq: ON" in line:
                        color = OSD_INFO_WARN_COLOR
                    _draw_text(pl.osd_img, x0, y0 + idx * OSD_INFO_LINE_H, line, color)

            pl.show_image()                               # Show result on display
            gc.collect()                                  # Run garbage collection
            _loop_ms = _ticks_diff(_ticks_ms(), _loop_begin_ms)
            _loop_ema_ms = _ema(_loop_ema_ms, _loop_ms)
            _infer_ema_ms = _ema(_infer_ema_ms, _infer_ms)
finally:
    try:
        if trigger_pin is not None:
            trigger_pin.value(TRIGGER_INACTIVE_LEVEL)
    except Exception:
        pass
    try:
        det_app.deinit()
    except Exception:
        pass
    try:
        pl.destroy()
    except Exception:
        pass
