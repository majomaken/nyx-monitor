#!/usr/bin/env python3
"""A fake music player for tests/headless.sh: owns org.mpris.MediaPlayer2.nyxtest on the session bus
and answers PlaybackStatus "Playing" until it is killed. Host python3 with PyGObject."""
import warnings

from gi.repository import Gio, GLib

warnings.filterwarnings("ignore", category=DeprecationWarning)  # register_object with closures still works

XML = """<node><interface name="org.mpris.MediaPlayer2.Player">
<property name="PlaybackStatus" type="s" access="read"/></interface></node>"""


def get_property(conn, sender, path, iface, prop):
    return GLib.Variant("s", "Playing")


def on_bus(conn, name):
    info = Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0]
    conn.register_object("/org/mpris/MediaPlayer2", info, None, get_property, None)


Gio.bus_own_name(Gio.BusType.SESSION, "org.mpris.MediaPlayer2.nyxtest", Gio.BusNameOwnerFlags.NONE, on_bus, None, None)
GLib.MainLoop().run()
