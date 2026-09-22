# AkariSub

AkariSub presents ASS/SSA subtitles alongside video frames.

## Language

**Prepared frame**: A complete subtitle snapshot for one encoded video frame, including an explicitly blank snapshot when no subtitle is visible.

**Presentation**: The subtitle image visible alongside a particular video frame. Preparation can finish before presentation occurs.

**Stage**: A prepared subtitle canvas awaiting or participating in a compositor swap. A stage can remain visible after its snapshot leaves the prefetch cache.

**Runway**: The sequence of prepared frames following the current video frame. Paused exact-frame readiness includes filling the requested runway.

**Preloaded track**: A subtitle track whose content and required fonts are ready without replacing the active track. Activation consumes it and starts a matching readiness cycle.

**Track activation**: Replacement of the active subtitle track by a preloaded track. Its readiness includes the requested runway when exact-frame playback is paused.
