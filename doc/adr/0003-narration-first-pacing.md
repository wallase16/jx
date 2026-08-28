# Walkthroughs are paced narration-first, not video-first

Each cue's narration is synthesized to audio and measured with `ffprobe` **before** the browser is
driven; the capture is then paced to fill that length. The obvious order — film the flow, then
narrate over it — requires the words to fit a duration fixed before the words existed, and every
subsequent UI change re-opens that fit. Inverting it deletes the synchronisation problem rather than
solving it.

## Consequences

Narration length is an input, so a cue whose steps run longer than its line extends the cue and is
reported (_acted_ exceeded _spoken_). The video stays correct and the report is the prompt to write
a longer line — a documentation task, not a timing bug.

This also fixes the direction of the whole pipeline: audio is generated first, so the TTS interface
and its cache sit upstream of capture, and a walkthrough can be re-paced without re-driving the
browser.
