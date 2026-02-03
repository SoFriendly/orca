import "./index.css";
import { Composition } from "remotion";
import { MyComposition } from "./Composition";

// 24 seconds at 30fps = 720 frames (synced to 75 BPM)
// With TransitionSeries: (120 + 144 + 144 + 144 + 144 + 144) - (5 * 24) = 720 frames
const DURATION_IN_FRAMES = 720;
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ChellLaunchVideo"
        component={MyComposition}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    </>
  );
};
