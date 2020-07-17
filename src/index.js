const Readline = require("readline-promise").default;
const Request = require("request-promise-native");
const Fs = require("fs-extra");
const Path = require("path");
const { exec } = require("child_process");
const { platform } = require("os");

const downloadedFolder = Path.resolve(process.cwd(), "../downloaded");
const apng2gifPath = Path.resolve(__dirname, "../utils", platform() === "win32" ? "apng2gif.exe" : "apng2gif");
const Url = process.argv[2];

const rlp = Readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

//region Metadata

async function retrievePackMetadata(id) {
  const {
    title: { en: title },
    stickers,
    hasAnimation
  } = await Request({
    uri: `http://dl.stickershop.line.naver.jp/products/0/0/1/${id}/android/productInfo.meta`,
    json: true
  });

  const stickerIds = stickers.map(s => s.id);

  return { packId: id, title, stickerIds, hasAnimation };
}

function extractPackId(url) {
  try {
    return url.match(/product\/(\d+)/)[1];
  } catch (err) {
    console.error("Invalid URL!");
    throw err;
  }
}

//endregion

//region Download

async function downloadPack({ packId, title, stickerIds, hasAnimation }) {
  // remove invalid path characters
  const validTitle = title.replace(/[^\w\s()-]/gi, '');

  const packDir = Path.resolve(downloadedFolder, validTitle);
  await Fs.emptyDir(packDir);

  console.log(`Downloading to: ${packDir}...`);

  const promises = stickerIds.map(stickerId => {
    const url = hasAnimation
      ? `https://sdl-stickershop.line.naver.jp/products/0/0/1/${packId}/android/animation/${stickerId}.png`
      : `http://dl.stickershop.line.naver.jp/stickershop/v1/sticker/${stickerId}/android/sticker.png`;
    const target = Path.resolve(packDir, stickerId + ".png");
    return download(url, target, stickerId);
  });

  await Promise.all(promises);
  return packDir;
}

function download(url, target, stickerId) {
  return new Promise(function (resolve, reject) {
    Request(url).pipe(Fs.createWriteStream(target))
      .on('finish', () => {
        console.log(`   >> Sticker: ${stickerId}`);
        resolve();
      })
      .on('error', reject)
  });
}

//endregion

//region PNG to GIF

async function convertToGif(stickerFolder, stickerIds) {
  const promises = stickerIds.map(stickerId => convertOne(stickerId, stickerFolder));

  console.log(`\nConverting APNG to GIF:`);

  return Promise.all(promises);
}

function execAsync(command, folder) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: folder }, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(stderr);
      resolve(stdout);
    });
  });
}

function convertOne(stickerId, folder) {
  const magickCommand = `magick convert ${stickerId}.gif -loop 0 -coalesce -background white -alpha remove ${stickerId}.gif`;
  return execAsync(`${apng2gifPath} ${stickerId}.png -b 255 255 255`, folder)
    .then(() => execAsync(magickCommand, folder, process.env.ComSpec))
    .then(() => Fs.remove(Path.resolve(folder, stickerId + ".png")))
    .then(() => console.log(`   >> Converted ${stickerId}`));
}

//endregion

async function main() {
  const url = Url || (await rlp.questionAsync("Sticker pack URL = "));
  const packId = extractPackId(url);
  const metadata = await retrievePackMetadata(packId);

  console.log(`Loaded pack: "${metadata.title}".`);

  const stickerFolder = await downloadPack(metadata);

  if (metadata.hasAnimation) await convertToGif(stickerFolder, metadata.stickerIds);
}

main()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

