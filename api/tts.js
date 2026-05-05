export default async function handler(req, res) {
    const text = req.query.text;
    const voice = req.query.voice || "zahar";
    const response = await fetch("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", {
        method: "POST",
        headers: {
            "Authorization": "Api-Key " + process.env.YANDEX_API_KEY
        },
        body: new URLSearchParams({
            text,
            lang: "ru-RU",
            voice: voice,
            format: "mp3"
        })
    });

    const buffer = await response.arrayBuffer();

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(buffer));
}