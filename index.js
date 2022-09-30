require('dotenv').config()

const request = require('request')
const compression = require('compression')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const express = require('express')
const Redis = require("ioredis")
const youtubedl = require('youtube-dl-exec')

const app = express()
const redis = new Redis(process.env.REDIS_URL)

app.set('port', (process.env.PORT || 5000))
app.set('trust proxy', 2)
app.use(express.json())
app.use(compression())
app.use(cors())

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

app.post('/get_video', async (req, resp) => {
    let json_body = req.body

    function get_content_(data) {
        let result = {
            video: {}
        }
        let collector = []

        function sort_coll_() {
            collector.sort(function(a, b) {
                let keyA = a.filesize,
                    keyB = a.filesize
                if (keyA < keyB) return -1
                if (keyA > keyB) return 1
                return 0
            })
        }

        function builder_(cur, audio=false) {
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

        for (let i = 0; i < data.length; i++) {
            if (typeof data[i].asr !== 'undefined') {
                if (data[i].asr) {
                    if (data[i].resolution == "audio only" && data[i].asr == 48000) {
                        collector.push(data[i])
                        sort_coll_()
                        result.audio = builder_(collector[0], audio=true)
                    } else if (["360p", "720p"].includes(data[i].format_note)) {
                        result.video[`q${data[i].format_note}`] = builder_(data[i])
                    } 
                } else if (["144p", "240p", "480p", "720p", "1080p", "1440p"].includes(data[i].format_note)) {
                    result.video[`q${data[i].format_note}`] = builder_(data[i])
                }
            }
        }
        return result
    }

    try {
        if (json_body.video_id) {
            function response_call(result) {
                return resp.send({
                    success: true,
                    body: result
                })
            }
            redis.get(json_body.video_id, (error, result) => {
                if (error) throw error
                if (result !== null) {
                    return response_call(JSON.parse(result))
                } else {
                    youtubedl(`https://www.youtube.com/watch?v=${json_body.video_id}`, {
                        dumpSingleJson: true,
                        noCheckCertificates: true,
                        noWarnings: true,
                        preferFreeFormats: true,
                        addHeader: [
                            'referer:youtube.com',
                            'user-agent:googlebot'
                        ]

                    }).then(output => {
                        output.formats = get_content_(output.formats)
                        let result = output
                        redis.set(json_body.video_id, JSON.stringify(result), "ex", 600)
                        return response_call(result)
                    })
                }
            })
        } else {
            return resp.send({
                success: false,
                error: "video_id: null"
            })
        }
    } catch (_) {
        return resp.send({
            success: false,
            error: "internal error function"
        })
    }
})

app.get('*', async (req, resp) => {
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
