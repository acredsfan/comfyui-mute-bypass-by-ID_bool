try:
    from server import PromptServer  # pyright: ignore[reportMissingImports]
except ImportError:
    PromptServer = None


STATUS_SYNC_EVENT = "pixelpainter.remote_control.status"


def _normalize_unique_id(unique_id):
    if unique_id is None:
        return None
    if isinstance(unique_id, (list, tuple)):
        return ":".join(str(part) for part in unique_id)
    return str(unique_id)


def _coerce_bool(value):
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "active"}
    return bool(value)


def _send_status_sync(unique_id, status_name, status_value, mode_select):
    node_id = _normalize_unique_id(unique_id)
    if PromptServer is None or not node_id or getattr(PromptServer, "instance", None) is None:
        return

    PromptServer.instance.send_sync(
        STATUS_SYNC_EVENT,
        {
            "node_id": node_id,
            "status_name": status_name,
            "active": _coerce_bool(status_value),
            "mode_select": _coerce_bool(mode_select),
        },
    )


def _has_image_data(image):
    if image is None:
        return False

    shape = getattr(image, "shape", None)
    if shape is not None:
        try:
            if len(shape) == 0:
                return False
            if shape[0] == 0:
                return False
            return True
        except Exception:
            return True

    try:
        return len(image) > 0
    except Exception:
        return True

class RemoteControl:
    """remote mb single"""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode_select": ("BOOLEAN", {"default": False, "label_on": "mute", "label_off": "bypass"}),
                "node_status": ("BOOLEAN", {"default": True, "label_on": "active", "label_off": "mute/bypass"}),
                "target_node": ("STRING", {"default": "", "multiline": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "mute bypass by ID"

    def do_nothing(self, mode_select, node_status, target_node, unique_id=None):
        _send_status_sync(unique_id, "node_status", node_status, mode_select)
        return ()


class RemoteControlMulti:
    """remote mb triple"""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode_select": ("BOOLEAN", {"default": False, "label_on": "mute", "label_off": "bypass"}),
                "node_status": ("BOOLEAN", {"default": True, "label_on": "active", "label_off": "mute/bypass"}),
                "target_node_1": ("STRING", {"default": "", "multiline": False}),
                "target_node_2": ("STRING", {"default": "", "multiline": False}),
                "target_node_3": ("STRING", {"default": "", "multiline": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "mute bypass by ID"

    def do_nothing(self, mode_select, node_status, target_node_1, target_node_2, target_node_3, unique_id=None):
        _send_status_sync(unique_id, "node_status", node_status, mode_select)
        return ()


class RemoteSwitch:
    """Switch between two targets (A vs B)"""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode_select": ("BOOLEAN", {"default": False, "label_on": "mute", "label_off": "bypass"}),
                "switch_status": ("BOOLEAN", {"default": True, "label_on": "Side A Active", "label_off": "Side B Active"}),
                "target_node_A": ("STRING", {"multiline": False, "default": ""}),
                "target_node_B": ("STRING", {"multiline": False, "default": ""}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "mute bypass by ID"

    def do_nothing(self, mode_select, switch_status, target_node_A, target_node_B, unique_id=None):
        _send_status_sync(unique_id, "switch_status", switch_status, mode_select)
        return ()


class RemoteSwitchMulti:
    """Switch between two pairs of targets (A1/A2 vs B1/B2)"""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode_select": ("BOOLEAN", {"default": False, "label_on": "mute", "label_off": "bypass"}),
                "switch_status": ("BOOLEAN", {"default": True, "label_on": "Side A Active", "label_off": "Side B Active"}),
                "target_node_A1": ("STRING", {"multiline": False, "default": ""}),
                "target_node_A2": ("STRING", {"multiline": False, "default": ""}),
                "target_node_B1": ("STRING", {"multiline": False, "default": ""}),
                "target_node_B2": ("STRING", {"multiline": False, "default": ""}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "mute bypass by ID"

    def do_nothing(self, mode_select, switch_status, target_node_A1, target_node_A2, target_node_B1, target_node_B2, unique_id=None):
        _send_status_sync(unique_id, "switch_status", switch_status, mode_select)
        return ()


class ImagePresenceBool:
    """Return a boolean indicating whether an image input is connected and non-empty."""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("has_image",)
    FUNCTION = "check_image"
    CATEGORY = "mute bypass by ID"

    def check_image(self, image=None):
        return (_has_image_data(image),)

class RemoteStacker:
    """Global mute/bypass stacker - auto-discovers Remote Control nodes and
    provides one-click User / Mute / Bypass override for all of them."""
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "mute bypass by ID"

    def do_nothing(self, unique_id=None):
        return ()
