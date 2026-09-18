import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo, Video } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

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
  const video = await getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("No video found with that id.");
  }
  if (userID !== video.userID) {
    throw new UserForbiddenError("User not owner of this video");
  };
  const arrayBuffer: ArrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer).toString("base64");
  const dataURL = `data:${mediaType};base64,${buffer}`;
  video.thumbnailURL =  dataURL;
  await updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
