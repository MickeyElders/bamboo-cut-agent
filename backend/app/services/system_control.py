from __future__ import annotations

import asyncio
import os
import shutil
import socket
import time
from typing import Sequence

from ..models import NetworkInterfaceStatus, SystemActionAck, SystemMaintenanceSnapshot

try:
    import psutil  # type: ignore
except Exception:
    psutil = None


class SystemControlService:
    def __init__(self) -> None:
        self._app_service = os.getenv("BAMBOO_SERVICE_NAME", "bamboo.service")
        self._frontend_port = int(os.getenv("FRONTEND_PORT", "5173"))
        self._network_service_candidates = (
            os.getenv("NETWORK_SERVICE"),
            "NetworkManager.service",
            "dhcpcd.service",
            "systemd-networkd.service",
        )

    async def snapshot(self) -> SystemMaintenanceSnapshot:
        hostname = socket.gethostname()
        default_interface = await self._default_interface()
        interfaces = self._interfaces()
        ip_addresses = self._all_ipv4(interfaces)
        wifi_ssid = await self._wifi_ssid()
        disk = self._disk_usage()
        return SystemMaintenanceSnapshot(
            hostname=hostname,
            device_url=f"http://127.0.0.1:{self._frontend_port}",
            default_interface=default_interface,
            wifi_ssid=wifi_ssid,
            network_online=bool(ip_addresses),
            ip_addresses=ip_addresses,
            interfaces=interfaces,
            disk_total_gb=disk["total_gb"],
            disk_used_gb=disk["used_gb"],
            disk_free_gb=disk["free_gb"],
            disk_percent=disk["percent"],
            supported_actions=["restart_app", "restart_network", "reboot_device", "shutdown_device"],
        )

    async def execute_action(self, action: str) -> SystemActionAck:
        if action == "restart_app":
            await self._run_systemctl(["restart", self._app_service], no_block=True)
            detail = "已提交界面重启请求"
        elif action == "restart_network":
            network_service = await self._network_service()
            if network_service is None:
                raise ValueError("未检测到可重启的网络服务")
            await self._run_systemctl(["restart", network_service], no_block=True)
            detail = f"已提交网络重启请求: {network_service}"
        elif action == "reboot_device":
            await self._run_systemctl(["reboot"], no_block=True)
            detail = "已提交设备重启请求"
        elif action == "shutdown_device":
            await self._run_systemctl(["poweroff"], no_block=True)
            detail = "已提交设备关机请求"
        else:
            raise ValueError(f"Unsupported system action: {action}")

        return SystemActionAck(action=action, detail=detail, timestamp=time.time())

    async def _run_systemctl(self, args: Sequence[str], *, no_block: bool) -> None:
        command = ["sudo", "-n", "systemctl"]
        if no_block:
            command.append("--no-block")
        command.extend(args)
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
        if process.returncode != 0:
            detail = (stderr or stdout).decode(errors="ignore").strip()
            if "a password is required" in detail.lower():
                raise ValueError("当前用户没有免密 sudo 权限，无法执行设备维护操作")
            raise ValueError(detail or "设备维护操作执行失败")

    async def _is_active(self, unit: str) -> bool:
        process = await asyncio.create_subprocess_exec(
            "systemctl",
            "is-active",
            unit,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
        return stdout.decode(errors="ignore").strip() == "active"

    async def _default_interface(self) -> str | None:
        process = await asyncio.create_subprocess_exec(
            "ip",
            "route",
            "show",
            "default",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
        line = stdout.decode(errors="ignore").strip().splitlines()
        if not line:
            return None
        parts = line[0].split()
        if "dev" not in parts:
            return None
        index = parts.index("dev")
        if index + 1 >= len(parts):
            return None
        return parts[index + 1]

    async def _wifi_ssid(self) -> str | None:
        process = await asyncio.create_subprocess_exec(
            "iwgetid",
            "-r",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
        value = stdout.decode(errors="ignore").strip()
        return value or None

    async def _network_service(self) -> str | None:
        for name in self._network_service_candidates:
            if not name:
                continue
            if await self._is_active(name):
                return name
        for name in self._network_service_candidates:
            if name:
                return name
        return None

    def _interfaces(self) -> list[NetworkInterfaceStatus]:
        if psutil is None:
            return []
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        result: list[NetworkInterfaceStatus] = []
        for name in sorted(addrs.keys()):
            ipv4: list[str] = []
            mac: str | None = None
            for addr in addrs[name]:
                family = getattr(addr.family, "name", str(addr.family))
                if family == "AF_INET":
                    ipv4.append(addr.address)
                elif family == "AF_PACKET":
                    mac = addr.address
            kind = "wifi" if name.startswith("wl") else "ethernet" if name.startswith("en") or name.startswith("eth") else "other"
            result.append(
                NetworkInterfaceStatus(
                    name=name,
                    is_up=bool(stats.get(name).isup) if name in stats else False,
                    ipv4=ipv4,
                    mac=mac,
                    kind=kind,
                )
            )
        return result

    def _all_ipv4(self, interfaces: list[NetworkInterfaceStatus]) -> list[str]:
        result: list[str] = []
        for item in interfaces:
            for ip in item.ipv4:
                if ip.startswith("127."):
                    continue
                result.append(ip)
        return result

    def _disk_usage(self) -> dict[str, float | None]:
        try:
            usage = shutil.disk_usage("/")
        except Exception:
            return {"total_gb": None, "used_gb": None, "free_gb": None, "percent": None}
        total = usage.total / (1024**3)
        free = usage.free / (1024**3)
        used = usage.used / (1024**3)
        percent = 0.0 if usage.total == 0 else (usage.used / usage.total) * 100.0
        return {
            "total_gb": round(total, 1),
            "used_gb": round(used, 1),
            "free_gb": round(free, 1),
            "percent": round(percent, 1),
        }
