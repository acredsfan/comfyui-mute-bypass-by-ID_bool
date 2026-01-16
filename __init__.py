from .remote_control import RemoteControl, RemoteControlMulti, RemoteSwitch, RemoteSwitchMulti

NODE_CLASS_MAPPINGS = {
    "RemoteControl": RemoteControl,
    "RemoteControlMulti": RemoteControlMulti,
    "RemoteSwitch": RemoteSwitch,
    "RemoteSwitchMulti": RemoteSwitchMulti
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RemoteControl": "Mute Bypass by ID — Single",
    "RemoteControlMulti": "Mute Bypass by ID — Triple",
    "RemoteSwitch": "Mute Bypass by ID — A/B",
    "RemoteSwitchMulti": "Mute Bypass by ID — AA/BB"
}

WEB_DIRECTORY = "./js"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
