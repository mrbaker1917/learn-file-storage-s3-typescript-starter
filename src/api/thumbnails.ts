import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { randomBytes } from "crypto";
const path = require('node:path');
type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};


export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const file = formData.get("thumbnail");
  if (!(file instanceof File)) {
    throw new BadRequestError("Not correct file format.");
  };
  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file is too large.");
  };
  const mediaType = file.type;
  if ((mediaType !== "image/jpeg") && (mediaType !== "image/png")) {
    throw new BadRequestError("Thumbnail file must be a jpeg or png file.");
  };
  const fileExtension = mediaType.split("/")[1];
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("No video found with that id.");
  }
  if (userID !== video.userID) {
    throw new UserForbiddenError("User not owner of this video");
  };
  const arrayBuffer: ArrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const videoUniqueAddr = randomBytes(32).toString("base64url");
  const filePath = path.join(cfg.assetsRoot, `${videoUniqueAddr}.${fileExtension}`);
  Bun.write(filePath, buffer);
  const dataURL = `http://localhost:${cfg.port}/assets/${videoUniqueAddr}.${fileExtension}`;
  video.thumbnailURL =  dataURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
};
