"""dai-skills — AI-native skill library for Dataspheres AI."""

from importlib.metadata import version as _pkg_version, PackageNotFoundError

try:
    __version__ = _pkg_version("dai-skills")
except PackageNotFoundError:
    __version__ = "0.0.0-dev"
