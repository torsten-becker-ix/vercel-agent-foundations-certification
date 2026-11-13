import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the favicon's white triangle on black, as a PNG. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
      }}
    >
      <svg height="100" viewBox="0 0 20 18" width="110">
        <path d="M10 0 20 18H0Z" fill="#fff" />
      </svg>
    </div>,
    size,
  );
}
