const R = require('retra')
const RateLimiter = require(__dirname)

const app = new R()

const rl = new RateLimiter({
	'cloudflare': false,
	'blockMessage': 'You are being ratelimited.'
}, [
	{
		'limit': 30,
		'time': [1, 'minute'],
		'method': 'GET'
	},
	{
		'limit': 2,
		'time': [5, 's'],
		'blockMessage': 'Too many requests to /hello2',
		'pathname': /^\/hello2/
	},
	{
		'limit': 5,
		'time': [15, 'seconds'],
		'blockMessage': 'You\'re POSTing too quickly!',
		'method': 'POST'
	}
])

app.use(rl.extension)

app.add('GET', '/hey', (req, res) => {
	res.status(200).body('Hi!').end()
})

app.add('POST', '/hello', (req, res) => {
	if (req.query('norl') === 'true') {
		console.log('NORL')
		req.disqualifyRL()
	}

	res.status(200).body('Hi there!').end()
})

app.add('/hello2', (req, res) => {
	res.status(200).body('Hello 2!').end()
})

app.add((req, res) => {
	res.status(404).body({
		'error': 'Resource not found'
	})
})

app.listen(8080, () => {
	console.log('Listening')
})