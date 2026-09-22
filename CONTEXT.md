# AkariSub

AkariSub presents ASS/SSA subtitles alongside video frames.

## Language

**Prepared frame**: A complete subtitle snapshot for one encoded video frame, including an explicitly blank snapshot when no subtitle is visible.

**Presentation**: The subtitle image visible alongside a particular video frame. Preparation can finish before presentation occurs.

**Stage**: A prepared subtitle canvas awaiting or participating in a compositor swap. A stage can remain visible after its snapshot leaves the prefetch cache.

**Runway**: The sequence of prepared frames following the current video frame. Paused exact-frame readiness includes filling the requested runway.
