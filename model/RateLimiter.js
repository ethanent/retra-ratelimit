module.exports = class RateLimiter {
	constructor (options, rules) {
		this.logs = []

		this.options = options
		this.rules = rules

		this.extension = (req, res, next) => {
			const connectingIP = this.options.cloudflare ? req.headers['cf-connecting-ip'] : req.from
			const requestedPathname = req.parsedUrl.pathname

			const newLog = {
				'pathname': requestedPathname,
				'ip': connectingIP,
				'method': req.method,
				'at': Date.now()
			}

			this.logs.push(newLog)

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

	_handleLimiting (req, res, next, newLog) {
		const associatedRules = this.rules.filter((rule) => this._logMatchesRule(newLog, rule))

		for (let i = 0; i < associatedRules.length; i++) {
			const matchingLogs = this._fetchLogs(this._convertTime(associatedRules[i].time)).filter((log) => this._logMatchesRule(log, associatedRules[i]))

			const actualLimit = this.options.varyLimit ? associatedRules[i].limit + (Math.floor(Math.random() * 4)) - 2 : associatedRules[i].limit

			if (matchingLogs.length > actualLimit) {
				res.status(429).body({
					'error': associatedRules[i].blockMessage || this.options.blockMessage || 'You\'re being ratelimited.'
				}).end()
				return
			}
		}

		next()
	}
}