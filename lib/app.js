var express    = require('express'),
    flatten    = require('flatten').flatten,
    hogan      = require('hogan.js'),
    gobo       = require('gobo'),
    path       = require('path'),
    fs         = require('fs'),
    app        = express(),
    errors     = require('./errors'),
    options    = require('./config'),
    store      = require('./store')(options.store),
    models     = require('./models'),
    session    = require('./session'),
    handlers   = require('./handlers'),
    middleware = require('./middleware'),
    flattened;

app.store  = store;
app.models = models.createModels(store);
app.templates = {};

app.PRODUCTION  = 'production';
app.DEVELOPMENT = 'development';

// Apply the keys from the config file. All nested properties are
// space delimited to match the express style.
//
// For example, app.set('url prefix'); //=> '/'
flattened = flatten(options, ' ');
Object.getOwnPropertyNames(flattened).forEach(function (key) {
  app.set(key, flattened[key]);
});

app.set('root', path.resolve(path.join(__dirname, '..')));
app.set('version', require('../package').version);
app.set('url full', (options.url.ssl ? 'https://' : 'http://') + options.url.host + options.url.prefix);

// Register all the middleware.
app.use(express.logger());
app.use(express.static(path.join(app.set('root'), 'public')));
app.use(express.cookieParser(app.set('session secret')));
app.use(express.cookieSession({key: 'jsbin'}));
app.use(express.bodyParser());
app.use(express.csrf());
app.use(middleware.noslashes());
app.use(middleware.ajax());
app.use(middleware.jsonp());
app.use(middleware.helpers(app));

// Create a Hogan/Mustache handler for templates.
app.engine('html', function (path, options, fn) {
  fs.readFile(path, 'utf8', function (err, template) {
    if (err) {
      return fn(err);
    }

    try {
      var compiled = app.templates[path];
      if (!compiled) {
        compiled = app.templates[path] = hogan.compile(template);
      }

      fn(null, compiled.render(options));
    } catch (error) {
      fn(error);
    }
  });
});

// Configure the template engine.
app.set('view engine', 'html');
app.set('views', path.join(app.set('root'), 'views'));

// Define some generic template variables.
app.locals({
  root: app.set('url full'),
  version: app.set('version'),
  home: null
});

// Load the bin from the store when encountered in the url. Also handles the
// "latest" url action.
app.param('bin', handlers.loadBin);

// Set up the routes.
app.get('/', handlers.getDefault);

// Login/Create account.
app.post('/sethome', session.loadUser, session.loginUser, session.createUser);

// Latest
app.get('/:bin/latest((.|\/):format)?', handlers.redirectToLatest);
app.get('/:bin/latest/edit', handlers.redirectToLatest);

// Edit
app.get('/:bin/:rev?/edit', handlers.getBin);

// Save
app.post('/save', handlers.createBin);
app.post('/:bin/:rev?/save', handlers.createRevision);

// Source
app.get('/:bin/:rev?/source', handlers.getBinSource);
app.get('/:bin/:rev?.:format(js|json|css|html)', handlers.getBinSourceFile);
app.get('/:bin/:rev?/:format(js)', function (req, res) {
  // Redirect legacy /js suffix to the new .js extension.
  res.redirect(301, req.path.replace(/\/js$/, '.js'));
});

// Preview
app.get('/:bin/:quiet(quiet)?', handlers.getBinPreview);
app.get('/:bin/:rev?/:quiet(quiet)?', handlers.getBinPreview);

// Serve the concatenated JavaScript.
app.get('/js/debug/jsbin.js', function (req, res) {
  var js = path.join(app.set('root'), 'public', 'js');
  gobo(path.join(js, 'jsbin.js'), 'vendor', function (content) {
    res.contentType('js');
    res.send(content);
  });
});

// Error handler.
app.use(function (err, req, res, next) {
  if (err instanceof errors.NotFound) {
    return handlers.notFound(req, res);
  }
  next(err);
});

// Final connect in error handler. Ideally should never hit this.
app.use(express.errorHandler({showStack: true, dumpExceptions: true}));

// Export the application to allow it to be included.
module.exports = app;
if (app.set('url prefix') !== '/') {
  // If we have a prefix then mount the app within another
  // express app to save us hacking around with the routes.
  module.exports = express().use(app.set('url prefix'), app);
}

// Run a local development server if this file is called directly.
if (require.main === module) {
  store.connect(function (err) {
    if (err) {
      throw err;
    }
    module.exports.listen(3000);
  });
}