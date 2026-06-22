import { describe, expect, it } from "vite-plus/test";
import {
  isActiveMediaPlayerState,
  readMediaPlayerContainer,
  readMediaPlayerInfo,
  readMediaPlayerPositionMs,
  readMediaPlayerState,
} from "../src/index.js";

const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<player error="false" state="play">
  <plugin bandwidth="5557597 bps" id="dev" name="Example Channel"/>
  <format audio="aac" captions="srt" container="mp4" drm="none" video="mpeg4_15" video_res="1024x436"/>
  <buffering current="1000" max="1000" target="0"/>
  <position>7500 ms</position>
  <duration>888085 ms</duration>
  <is_live>false</is_live>
</player>`;

describe("media-player helpers", () => {
  it("reads media-player XML into typed playback state", () => {
    expect(readMediaPlayerInfo(xml)).toEqual({
      audio: "aac",
      buffering: {
        current: 1000,
        max: 1000,
        target: 0,
      },
      captions: "srt",
      container: "mp4",
      durationMs: 888085,
      error: false,
      isLive: false,
      positionMs: 7500,
      state: "play",
      video: "mpeg4_15",
      videoResolution: "1024x436",
    });
  });

  it("exposes focused media-player readers", () => {
    expect(readMediaPlayerState(xml)).toBe("play");
    expect(readMediaPlayerContainer(xml)).toBe("mp4");
    expect(readMediaPlayerPositionMs(xml)).toBe(7500);
  });

  it("detects active playback states", () => {
    expect(isActiveMediaPlayerState("buffer")).toBe(true);
    expect(isActiveMediaPlayerState("buffering")).toBe(true);
    expect(isActiveMediaPlayerState("pause")).toBe(true);
    expect(isActiveMediaPlayerState("play")).toBe(true);
    expect(isActiveMediaPlayerState("stop")).toBe(false);
    expect(isActiveMediaPlayerState(undefined)).toBe(false);
  });
});
