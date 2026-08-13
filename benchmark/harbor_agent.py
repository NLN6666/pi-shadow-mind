import json
import shlex
from pathlib import Path, PurePosixPath
from typing import Any, override

from harbor.agents.installed.base import with_prompt_template
from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_PLUGIN_VERSION = "0.1.7"
_PI_VERSION = "0.84.1"
_PLUGIN_ARCHIVE = _PROJECT_ROOT / "release" / f"pi-shadow-mind-{_PLUGIN_VERSION}.tgz"
_SHADOW_SOURCE = _PROJECT_ROOT / "benchmark" / "shadow-minds"
_REMOTE_AGENT_DIR = PurePosixPath("/installed-agent/pi-config")
_REMOTE_PLUGIN_DIR = PurePosixPath("/installed-agent/pi-shadow-mind")


class PiShadowBench(Pi):
    """Controlled Pi A/B adapter: no extensions vs. only Shadow Mind."""

    def __init__(
        self,
        *args: Any,
        variant: str = "baseline",
        seed: int | str | None = None,
        **kwargs: Any,
    ) -> None:
        if variant not in {"baseline", "shadow"}:
            raise ValueError("variant must be 'baseline' or 'shadow'")
        self.variant = variant
        self.seed = int(seed) if seed is not None else None
        if self.seed is not None and not 0 <= self.seed <= 0xFFFF_FFFF:
            raise ValueError("seed must be between 0 and 4294967295")
        if variant == "shadow" and self.seed is None:
            raise ValueError("shadow variant requires a seed")
        kwargs.setdefault("version", _PI_VERSION)
        super().__init__(*args, **kwargs)

    @staticmethod
    @override
    def name() -> str:
        return "pi-shadow-bench"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        await self.exec_as_root(
            environment,
            command=f"mkdir -p {_REMOTE_AGENT_DIR.as_posix()}",
        )
        if environment.default_user is not None:
            await self.exec_as_root(
                environment,
                command=f"chown -R {shlex.quote(str(environment.default_user))} {_REMOTE_AGENT_DIR.as_posix()}",
            )
        if self.variant == "shadow":
            await self._install_shadow_mind(environment)

    async def _install_shadow_mind(self, environment: BaseEnvironment) -> None:
        if not _PLUGIN_ARCHIVE.is_file():
            raise FileNotFoundError(f"Shadow Mind release not found: {_PLUGIN_ARCHIVE}")
        remote_archive = f"/installed-agent/{_PLUGIN_ARCHIVE.name}"
        await environment.upload_file(_PLUGIN_ARCHIVE, remote_archive)
        await self.exec_as_root(
            environment,
            command=(
                f"mkdir -p {_REMOTE_PLUGIN_DIR.as_posix()} && "
                f"tar -xzf {shlex.quote(remote_archive)} --strip-components=1 "
                f"-C {_REMOTE_PLUGIN_DIR.as_posix()}"
            ),
        )
        if environment.default_user is not None:
            await self.exec_as_root(
                environment,
                command=f"chown -R {shlex.quote(str(environment.default_user))} {_REMOTE_PLUGIN_DIR.as_posix()}",
            )
        await self.exec_as_agent(
            environment,
            command=(
                ". ~/.nvm/nvm.sh; "
                f"PI_CODING_AGENT_DIR={_REMOTE_AGENT_DIR.as_posix()} "
                f"pi install {_REMOTE_PLUGIN_DIR.as_posix()}"
            ),
        )

        remote_shadows = _REMOTE_AGENT_DIR / "shadow-minds"
        await self.exec_as_agent(environment, command=f"mkdir -p {remote_shadows.as_posix()}")
        config = json.loads((_SHADOW_SOURCE / "config.json").read_text())
        config["random_seed"] = self.seed
        config["default_shadow_model"] = self.model_name
        await self._upload_config_text(
            environment,
            content=json.dumps(config, indent=2) + "\n",
            remote_path=(remote_shadows / "config.json").as_posix(),
            filename="config.json",
        )
        for source in sorted(_SHADOW_SOURCE.glob("*.md")):
            await self._upload_agent_owned_file(
                environment, source, (remote_shadows / source.name).as_posix()
            )

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")

        provider, model = self.model_name.split("/", 1)
        access = self.model_connection
        env = dict(access.env)
        env["PI_CODING_AGENT_DIR"] = _REMOTE_AGENT_DIR.as_posix()
        provider = access.provider or provider
        variant_flags = "--no-extensions " if self.variant == "baseline" else ""
        management_tools = (
            "list_shadows,create_shadow,update_shadow,enable_shadow,disable_shadow,"
            "delete_shadow,get_shadow_config,update_shadow_config"
        )
        command = (
            ". ~/.nvm/nvm.sh; "
            "mkdir -p /logs/agent/pi/sessions; "
            "pi --print --mode json --session-dir /logs/agent/pi/sessions "
            "--offline --no-skills --no-prompt-templates --no-themes "
            f"{variant_flags}"
            f"--exclude-tools {management_tools} "
            f"--provider {shlex.quote(provider)} --model {shlex.quote(model)} "
            "--thinking high "
            f"{shlex.quote(instruction)} "
            "2>&1 </dev/null | grep -v '\"type\":\"message_update\"' "
            "| stdbuf -oL tee /logs/agent/pi.txt"
        )
        try:
            await self.exec_as_agent(environment, command=command, env=env)
        finally:
            if self.variant == "shadow":
                await self.exec_as_agent(
                    environment,
                    command=(
                        "mkdir -p /logs/artifacts/shadow-minds; "
                        f"if [ -d {_REMOTE_AGENT_DIR.as_posix()}/shadow-minds ]; then "
                        f"cp -R {_REMOTE_AGENT_DIR.as_posix()}/shadow-minds/. "
                        "/logs/artifacts/shadow-minds/; fi"
                    ),
                    env=env,
                )
