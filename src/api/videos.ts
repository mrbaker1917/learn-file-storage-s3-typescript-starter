import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "node:path";
import { rm } from "fs/promises";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("No video found with that id.");
  }
  if (userID !== video.userID) {
    throw new UserForbiddenError("User not owner of this video");
  };
  const formData = await req.formData();
  const file = formData.get("video");
  if (!(file instanceof File)) {
    throw new BadRequestError("Not correct file format.");
  };
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Videofile is too large.");
  };
  if (file.type !== "video/mp4") {
    throw new BadRequestError("Video file not in correct format.");
  };

  const filePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(filePath, file);
  const s3file = cfg.s3Client.file(`${videoId}.mp4`, { bucket: cfg.s3Bucket});
  await s3file.write(Bun.file(filePath), { type: "video/mp4"});
  video.videoURL =  `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoId}.mp4`;
  updateVideo(cfg.db, video);
  await rm(filePath, { force: true });
  return respondWithJSON(200, video);
};
