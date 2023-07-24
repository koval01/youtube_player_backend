require('dotenv').config()

const { promisify } = require('util');

const request = require('request')
const compression = require('compression')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const express = require('express')
const redis = require("ioredis")
const youtubedl = require('youtube-dl-exec')

const app = express()
const redis = new Redis(process.env.REDIS_URL)

app.set('port', (process.env.PORT || 5000))
app.set('trust proxy', 2)
app.use(express.json())
app.use(compression())
app.use(cors())

const getRedisAsync = promisify(redis.get).bind(redis)
const setRedisAsync = promisify(redis.set).bind(redis)

const apiLimiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minute
	max: 250,
	standardHeaders: true,
    message: {
        success: false,
        error: "too many requests"
    }
})
app.use(apiLimiter)

const builder_ = (cur, audio = false) => {
    let result = {
        format: cur.format,
        url: cur.url
    }
    if (audio) {
        result.acodec = cur.acodec
        result.ext = cur.ext
    } else {
        result.acodec = cur.acodec
        result.vcodec = cur.vcodec
        result.video_ext = cur.video_ext
        result.fps = cur.fps
    }
    return result
}

const get_content_ = (data) => {
    let result = {
        video: {}
    }
    let smallestAudioFile
    let videoFormats = ["144p", "240p", "480p", "720p", "1080p", "1440p", "2160p"]

    for (let i = 0; i < data.length; i++) {
        if (typeof data[i].asr !== 'undefined') {
            if (data[i].asr) {
                if (data[i].resolution == "audio only" && data[i].asr == 48000) {
                    if (!smallestAudioFile || data[i].filesize < smallestAudioFile.filesize) {
                        smallestAudioFile = data[i]
                        result.audio = builder_(data[i], true)
                    }
                } else if (["360p", "720p"].includes(data[i].format_note)) {
                    result.video[`q${data[i].format_note}`] = builder_(data[i])
                }
            } else if (videoFormats.includes(data[i].format_note)) {
                result.video[`q${data[i].format_note}`] = builder_(data[i])
            }
        }
    }
    return result
}

app.post('/getVideo', async (req, resp) => {
    try {
        const { video_id } = req.body

        if (!video_id) {
            return resp.send({
                success: false,
                error: "video_id: null"
            })
        }

        const redisResult = await getRedisAsync(video_id)

        if (redisResult) {
            return resp.send({
                success: true,
                body: JSON.parse(redisResult)
            })
        }

        const output = await youtubedl(`https://www.youtube.com/watch?v=${video_id}`, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: [
                'referer:youtube.com',
                'user-agent:googlebot'
            ]
        })

        const result = get_content_(output.formats)

        await setRedisAsync(video_id, JSON.stringify(result), "ex", 600)

        return resp.send({
            success: true,
            body: result
        })
    } catch (error) {
        return resp.send({
            success: false,
            error: "internal error function"
        })
    }
})

app.all('*', async (req, resp) => {
    return resp.status(404).json({
        success: false,
        error: "This route cannot be found",
    })
})

app.listen(app.get('port'), () => {
    console.info(`Node app is running at localhost:${app.get('port')}`)
})

process.on('uncaughtException', function (exception) {
    console.error(`Uncaught exception: ${exception}`)
})
