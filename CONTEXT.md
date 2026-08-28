# Jx

A full-stack web framework in which UI is a declarative JSON document, interpreted by runtimes and
edited by people, visual tools, and agents.

## Language

### Capture pipeline

The tooling that photographs and films Jx Studio from a manifest, so documentation illustrations are
re-rendered by a script rather than re-taken by a human.

**Shot**:
One boot of Studio, driven through named steps, producing one or more still images.
_Avoid_: screenshot (that is the output, not the unit)

**Walkthrough**:
One boot of Studio, narrated and filmed, covering a single feature flow.
_Avoid_: take (in film a take is one attempt at recording a shot — the opposite of a re-rendered
artifact, and the smallest unit rather than the largest), recording, clip, demo, video

**Cue**:
One line of narration and the steps performed while it is spoken. Its length is the length of the
spoken audio.
_Avoid_: scene (an order of magnitude larger in film), segment, beat

**Narration**:
The prose a Walkthrough speaks, authored in the manifest and reviewed in a diff.
_Avoid_: script, voiceover, transcript, subtitles

**Region**:
A named, addressable area of the Studio interface. The only way a Shot or Walkthrough may point at
the UI.
_Avoid_: selector, element, target, area

**Capture**:
One output image a Shot produces from a Region.
_Avoid_: clip (a retired verb that meant a crop rectangle), crop, frame

**Seed**:
State written on behalf of a remote boundary — a network or IPC call — never on behalf of a person.
Anything a person does is a command.
_Avoid_: stub, fixture, mock

**Overlay**:
The copy-on-write copy of a project that a Shot or Walkthrough opens, so nothing it types can reach
a committed starter.
_Avoid_: sandbox, scratch copy, working copy
