const genId = require('../lib/genId.js')

module.exports = class RateLimiter {
	constructor (options, rules) {
		this.logs = []

		this.options = options
		this.rules = rules

		this.currentId = 0
		this.workerMode = false

		const mostDurationRuleDuration = this._convertTime(this.rules.sort((a, b) => this._convertTime(a.time) > this._convertTime(b.time) ? -1 : 1)[0].time)

		this.extension = async (req, res, next) => {
			const connectingIP = this.options.cloudflare ? req.headers['cf-connecting-ip'] : req.from
			const requestedPathname = req.parsedUrl.pathname

			const requestId = await genId()

			const newLog = {
				'id': requestId,
				'pathname': requestedPathname,
				'ip': connectingIP,
				'method': req.method,
				'at': Date.now()
			}

			if (this.workerMode === true) {
				await this._requestParent({
					'action': 'saveLog',
					'log': newLog
				})
			}
			else {
				this.logs.push(newLog)
			}

			req.disqualifyRL = async () => {
				if (this.workerMode === true) {
					await this._requestParent({
						'action': 'disqualifyRL',
						'logId': requestId
					})
				}
				else {
					this.logs.splice(this.logs.findIndex((log) => log.id === requestId), 1)
				}
			}

			let checkIndex = 0

			while (this.logs.length > 0 && Date.now() - this.logs[0].at > mostDurationRuleDuration) {
				this.logs.shift()
			}

			this._handleLimiting(req, res, next, newLog)
		}
	}

	_convertTime (time) {
		const unitMultiplier = (time[1] === 's' || time[1] === 'second' || time[1] === 'seconds') ? 1000 :
							   ((time[1] === 'm' || time[1] === 'minute' || time[1] === 'minutes') ? 60 * 1000 :
							   ((time[1] === 'h' || time[1] === 'hour' || time[1] === 'hours') ? 60 * 60 * 1000 :
							   ((time[1] === 'd' || time[1] === 'day' || time[1] === 'days') ? 24 * 60 * 60 * 1000 :
							   1)))

		return time[0] * unitMultiplier
	}

	_fetchLogs (pastMilliseconds) {
		return this.logs.filter((log) => log.at > Date.now() - pastMilliseconds)
	}

	_logMatchesRule (log, rule) {
		if (rule.method && rule.method !== log.method) return false

		if (rule.pathname && (rule.pathname instanceof RegExp ? !rule.pathname.test(log.pathname) : rule.pathname !== log.pathname)) return false

		return true
	}

	async _shouldLimitRequest (newLog) {
		if (this.workerMode === true) {
			return await this._requestParent({
				'action': 'shouldLimit',
				'log': newLog
			})
		}
		else {
			const associatedRules = this.rules.filter((rule) => this._logMatchesRule(newLog, rule))

			for (let i = 0; i < associatedRules.length; i++) {
				const matchingLogs = this._fetchLogs(this._convertTime(associatedRules[i].time)).filter((log) => this._logMatchesRule(log, associatedRules[i]))

				const actualLimit = this.options.varyLimit ? associatedRules[i].limit + (Math.floor(Math.random() * 4)) - 2 : associatedRules[i].limit

				if (matchingLogs.length > actualLimit) {
					return {
						'block': true,
						'rule': associatedRules[i]
					}
				}
			}

			return {
				'block': false
			}
		}
	}

	async _handleLimiting (req, res, next, newLog) {
		const shouldLimit = await this._shouldLimitRequest(newLog)

		if (shouldLimit.block) {
			res.status(429).body({
				'error': shouldLimit.rule.blockMessage || this.options.blockMessage || 'You\'re being ratelimited.'
			}).end()
		}
		else {
			next()
		}
	}

	_requestParent (data) {
		return new Promise((resolve, reject) => {
			const id = this.currentId

			this.currentId++

			const message = Object.assign(data, {
				'id': id
			})

			process.send(message)

			const handler = (data) => {
				if (data.id === id) {
					process.removeListener('message', handler)
				}

				resolve(data)
			}

			process.on('message', handler)
		})
	}

	addWorker (worker) {
		worker.on('message', async (data) => {
			if (data.action === 'saveLog') {
				this.logs.push(data.log)
				worker.send({
					'id': data.id
				})
			}
			else if (data.action === 'shouldLimit') {
				worker.send(Object.assign(await this._shouldLimitRequest(data.log), {
					'id': data.id
				}))
			}
			else if (data.action === 'disqualifyRL') {
				this.logs.splice(this.logs.findIndex((log) => log.id === data.logId), 1)

				worker.send({
					'id': data.id
				})
			}
		})
	}

	deferToParent () {
		this.workerMode = true
	}
}