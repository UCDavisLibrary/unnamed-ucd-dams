var router = require('express').Router();
var authUtils = require('../lib/auth');
var utils = require('./utils');
var config = require('ucdlib-dams-utils/config');
var {URL} = require('url');

function hackBounce(req, res, next) {
  req.url = req.originalUrl;
  next();
}

function storeRedirect(req, res, next) {
  req.session.cliRedirectUrl = req.query.cliRedirectUrl || '';
  req.session.provideJwt = (req.query.provideJwt === 'true');
  next();
}

router.get('/cas', storeRedirect, hackBounce, authUtils.cas.bounce, async (req, res) => {
  var url = req.session.cliRedirectUrl || '/';

  if( req.session.provideJwt ) {
    var newJwt = await authUtils.jwt.createFromCasRequest(req);
    url += '?jwt='+newJwt+'&username='+req.session[ authUtils.cas.session_name ];
  }

  // reset stored redirect information
  req.session.provideJwt = false;
  req.session.cliRedirectUrl = '';

  res.redirect(url);
});

router.get('/token/create', authUtils.middleware.block, async (req, res) => {
  var username = req.query.username;
  if( !username ) return res.json({error: true, message: 'Username required'});

  try {
    let token = await authUtils.refreshToken(username);
    res.json({
      success : true,
      token : token
    });
  } catch(e) {
    res.json({
      error: true,
      message: e.message
    });
  }
});

router.post('/token/verify', async (req, res) => {
  let username = req.body.username;
  let token = req.body.token;

  try {
    let valid = await authUtils.refreshTokenVerification(username, token);
    if( valid ) {
      let isAdmin = await authUtils.isAdmin(username);
      res.json({
        success : true,
        jwt : authUtils.jwt.create(username, isAdmin)
      });
    } else {
      res.json({
        error : true,
        message: 'Invalid token'
      });
    }
  } catch(e) {
    res.json({
      error: true,
      message: e.message
    });
  }
});

router.get('/cas/user', authUtils.cas.block, async ( req, res ) => {
  var newJwt = await authUtils.jwt.createFromCasRequest(req);
  var isAdmin = await authUtils.isAdmin(req.session[ authUtils.cas.session_name ]);

  res.json({ 
      cas_user: req.session[ authUtils.cas.session_name ],
      admin : isAdmin,
      jwt : newJwt
  });
});

router.get('/login', authUtils.middleware.bounce, (req, res) => {
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  res.clearCookie(config.jwt.cookieName);
  res.redirect('/auth/cas/logout');
});

router.get('/cas/logout', authUtils.cas.logout);

router.get('/mint', authUtils.middleware.admin, (req, res) => {
  var username = req.query.username;
  var isAdmin = req.query.admin ? true : false;

  res.json({
    jwt : authUtils.jwt.create(username, isAdmin),
    username : username,
    admin : isAdmin
  });
});

router.post('/local', async (req, res) => {
  var username = req.body.username;
  var password = req.body.password;
  var userinfo;

  try { 
    var valid = await authUtils.localUserVerification(username, password);
    if( !valid ) return res.send({error: true, message: 'Unable to verify local user'});
    userinfo = await authUtils.getLocalUser(username);
  } catch(e) {
    res.json(utils.errorResponse(e, 'Unable to verify local user'));
  }

  var isAdmin = await authUtils.isAdmin(username);
  var token = authUtils.jwt.create(username, isAdmin);

  res.cookie(
    config.jwt.cookieName, 
    token,
    {httpOnly: true}
  );

  userinfo.jwt = token;
  res.json(userinfo);
});


module.exports = router;