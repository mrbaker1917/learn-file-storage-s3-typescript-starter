import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "node:path";
import { rm } from "fs/promises";
import { json } from "node:stream/consumers";

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
  const aspectRatio = await getVideoAspectRatio(filePath);
  const s3file = cfg.s3Client.file(`${aspectRatio}/${videoId}.mp4`, { bucket: cfg.s3Bucket});
  const outputFilePath = await processVideoForFastStart(filePath);
  await s3file.write(Bun.file(outputFilePath), { type: "video/mp4"});
  video.videoURL =  `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${aspectRatio}/${videoId}.mp4`;
  updateVideo(cfg.db, video);
  await rm(filePath, { force: true });
  await rm(outputFilePath, { force: true});
  return respondWithJSON(200, video);
};

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath]);
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  if (await proc.exited != 0) {
    throw new Error(stderrText);
  }
  const jsonObj = JSON.parse(stdoutText);
  const width = jsonObj["streams"][0]["width"];
  const height = jsonObj["streams"][0]["height"];
  const ratio = Math.floor(width/height* 100);
  let aspectRatio = "";
  if (ratio === Math.floor(16/9 * 100)) {
    aspectRatio = "landscape";
  } else if (ratio === Math.floor(9/16 * 100)) {
    aspectRatio = "portrait";
  } else {
    aspectRatio = "other";
  }
  return aspectRatio;
};

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = `${inputFilePath}.processed`;
  const proc = Bun.spawn(["ffmpeg", "-i", inputFilePath, "-movflags", "faststart", "-map_metadata", "0", "-codec", "copy", "-f", "mp4", outputFilePath]);
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  if (await proc.exited != 0) {
    throw new Error(stderrText);
  };
  return outputFilePath;
};