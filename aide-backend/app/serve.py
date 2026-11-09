"""Run Aide with phone access (start-phone.cmd).

Two listeners, one app:
- http://localhost:8000 for this computer only (localhost already counts as secure).
- https://<wifi address>:8443 for your phone, so its mic, notifications and install work.
  Plain HTTP is no longer reachable from other devices.

Run:  python -m app.serve   (with AIDE_LAN=on)
"""
from __future__ import annotations

import asyncio
import logging
import os

import uvicorn

from . import certs, phone

log = logging.getLogger("aide")


def main() -> None:
    os.environ.setdefault("AIDE_LAN", "on")
    from .main import app  # creates the app with settings from the environment

    settings = app.state.settings
    ips = certs.private_ips(phone.lan_ips())
    paths = certs.ensure(ips)
    log.info("Phone access: https://%s:%s (certificate for %s)", ips[0] if ips else "<no Wi-Fi>",
             settings.phone_port, ", ".join(ips) or "no address yet")

    local = uvicorn.Config(app, host="127.0.0.1", port=settings.port, log_level="info")
    lan = uvicorn.Config(app, host="0.0.0.0", port=settings.phone_port, log_level="info", lifespan="off",
                         ssl_certfile=str(paths["crt"]), ssl_keyfile=str(paths["key"]))
    servers = [uvicorn.Server(local), uvicorn.Server(lan)]

    async def run(server: uvicorn.Server) -> None:
        try:
            await server.serve()
        finally:  # when one stops (Ctrl+C or an error), stop the other too
            for s in servers:
                s.should_exit = True

    async def run_all() -> None:
        await asyncio.gather(*(run(s) for s in servers))

    try:
        asyncio.run(run_all())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
