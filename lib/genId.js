const crypto = require('crypto')

module.exports = () => {
	return new Promise((res, rej) => {
		crypto.randomBytes(7, (err, bytes) => {
			if (err) {
				rej(err)
			}
			else {
				res(bytes.join(''))
			}
		})
	})
}