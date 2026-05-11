const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

require('./services/logger.js');
const express = require('express');
const engine = require('ejs-mate');
const os = require('os');
const multer = require('multer');
const csrf = require('csrf');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('./models/User');
const { db, checkIfUsersExist, initializeDatabase } = require('./db/database');
const systemMonitor = require('./services/systemMonitor');
const { uploadVideo, upload, uploadThumbnail, uploadAudio } = require('./middleware/uploadMiddleware');
const chunkUploadService = require('./services/chunkUploadService');
const audioConverter = require('./services/audioConverter');
const { ensureDirectories } = require('./utils/storage');
const { getVideoInfo, generateThumbnail, generateImageThumbnail } = require('./utils/videoProcessor');
const Video = require('./models/Video');
const MediaFolder = require('./models/MediaFolder');
const Playlist = require('./models/Playlist');
const Stream = require('./models/Stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const streamingService = require('./services/streamingService');
const schedulerService = require('./services/schedulerService');
const packageJson = require('./package.json');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
process.on('unhandledRejection', (reason, promise) => {
  console.error('-----------------------------------');
  console.error('UNHANDLED REJECTION AT:', promise);
  console.error('REASON:', reason);
  console.error('-----------------------------------');
});
process.on('uncaughtException', (error) => {
  console.error('-----------------------------------');
  console.error('UNCAUGHT EXCEPTION:', error);
  console.error('-----------------------------------');
});
const app = express();
app.set("trust proxy", 1);
const port = process.env.PORT || 7575;
const tokens = new csrf();

ensureDirectories();
app.locals.helpers = {
  getUsername: function (req) {
    if (req.session && req.session.username) {
      return req.session.username;
    }
    return 'User';
  },
  getAvatar: function (req) {
    if (req.session && req.session.userId) {
      const avatarPath = req.session.avatar_path;
      if (avatarPath) {
        return `<img src="${avatarPath}" alt="${req.session.username || 'User'}'s Profile" class="w-full h-full object-cover" onerror="this.onerror=null; this.src='/images/default-avatar.jpg';">`;
      }
    }
    return '<img src="/images/default-avatar.jpg" alt="Default Profile" class="w-full h-full object-cover">';
  },
  getPlatformIcon: function (platform) {
    switch (platform) {
      case 'YouTube': return 'youtube';
      case 'Facebook': return 'facebook';
      case 'Twitch': return 'twitch';
      case 'TikTok': return 'tiktok';
      case 'Instagram': return 'instagram';
      case 'Shopee Live': return 'shopping-bag';
      case 'Restream.io': return 'live-photo';
      default: return 'broadcast';
    }
  },
  getPlatformColor: function (platform) {
    switch (platform) {
      case 'YouTube': return 'red-500';
      case 'Facebook': return 'blue-500';
      case 'Twitch': return 'purple-500';
      case 'TikTok': return 'gray-100';
      case 'Instagram': return 'pink-500';
      case 'Shopee Live': return 'orange-500';
      case 'Restream.io': return 'teal-500';
      default: return 'gray-400';
    }
  },
  formatDateTime: function (isoString) {
    if (!isoString) return '--';
    
    const utcDate = new Date(isoString);
    
    return utcDate.toLocaleString('en-US', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },
  formatDuration: function (seconds) {
    if (!seconds) return '--';
    const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${secs}`;
  }
};
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, 'db'),
    table: 'sessions'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: false, // Harus false jika menggunakan HTTP (bukan HTTPS)
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(async (req, res, next) => {
  if (req.session && req.session.userId) {
    try {
      const user = await User.findById(req.session.userId);
      if (user) {
        req.session.username = user.username;
        req.session.avatar_path = user.avatar_path;
        if (user.email) req.session.email = user.email;
        res.locals.user = {
          id: user.id,
          username: user.username,
          avatar_path: user.avatar_path,
          email: user.email
        };
      }
    } catch (error) {
      console.error('Error loading user:', error);
    }
  }
  res.locals.req = req;
  res.locals.appVersion = packageJson.version;
  next();
});
app.use(function (req, res, next) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = uuidv4();
  }
  res.locals.csrfToken = tokens.create(req.session.csrfSecret);
  next();
});
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.svg') || filePath.endsWith('.ico') || filePath.endsWith('.png')) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use('/uploads', function (req, res, next) {
  res.header('Cache-Control', 'no-cache');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});
app.use(express.urlencoded({ extended: true, limit: '50gb' }));
app.use(express.json({ limit: '50gb' }));

const csrfProtection = function (req, res, next) {
  if ((req.path === '/login' && req.method === 'POST') ||
    (req.path === '/setup-account' && req.method === 'POST')) {
    return next();
  }
  const token = req.body._csrf || req.query._csrf || req.headers['x-csrf-token'];
  if (!token || !tokens.verify(req.session.csrfSecret, token)) {
    return res.status(403).render('error', {
      title: 'Error',
      error: 'CSRF validation failed. Please try again.'
    });
  }
  next();
};
const isAuthenticated = async (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
};


const isAdmin = async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
    
    const user = await User.findById(req.session.userId);
    if (!user || user.user_role !== 'admin') {
      return res.redirect('/dashboard');
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.redirect('/dashboard');
  }
};
app.use('/uploads', function (req, res, next) {
  res.header('Cache-Control', 'no-cache');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});
app.use('/uploads/avatars', (req, res, next) => {
  const filename = path.basename(req.path);
  if (!filename || filename === 'avatars') {
    return res.status(403).send('Access denied');
  }
  const file = path.join(__dirname, 'public', 'uploads', 'avatars', filename);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    res.header('Content-Type', contentType);
    res.header('Cache-Control', 'max-age=60, must-revalidate');
    fs.createReadStream(file).pipe(res);
  } else {
    next();
  }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('login', {
      title: 'Login',
      error: 'Too many login attempts. Please try again in 15 minutes.'
    });
  },
  requestWasSuccessful: (request, response) => {
    return response.statusCode < 400;
  }
});
const loginDelayMiddleware = async (req, res, next) => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  next();
};
app.get('/login', async (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }

  try {
    const usersExist = await checkIfUsersExist();
    if (!usersExist) {
      return res.redirect('/setup-account');
    }
    
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();
    
    res.render('login', {
      title: 'Login',
      error: null,
      recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
    });
  } catch (error) {
    console.error('Error checking for users:', error);
    res.render('login', {
      title: 'Login',
      error: 'System error. Please try again.',
      recaptchaSiteKey: null
    });
  }
});
app.post('/login', loginDelayMiddleware, loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const recaptchaResponse = req.body['g-recaptcha-response'];
  
  try {
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();
    
    if (recaptchaSettings.hasKeys && recaptchaSettings.enabled) {
      if (!recaptchaResponse) {
        return res.render('login', {
          title: 'Login',
          error: 'Please complete the reCAPTCHA verification',
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }
      
      const { decrypt } = require('./utils/encryption');
      const secretKey = decrypt(recaptchaSettings.secretKey);
      
      const axios = require('axios');
      const verifyResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(recaptchaResponse)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      if (!verifyResponse.data.success) {
        return res.render('login', {
          title: 'Login',
          error: 'reCAPTCHA verification failed. Please try again.',
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }
    }
    
    const user = await User.findByUsername(username);
    if (!user) {
      return res.render('login', {
        title: 'Login',
        error: 'Invalid username or password',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }
    const passwordMatch = await User.verifyPassword(password, user.password);
    if (!passwordMatch) {
      return res.render('login', {
        title: 'Login',
        error: 'Invalid username or password',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }
    
    if (user.status !== 'active') {
      return res.render('login', {
        title: 'Login',
        error: 'Your account is not active. Please contact administrator for activation.',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }
    
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.avatar_path = user.avatar_path;
    req.session.user_role = user.user_role;
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', {
      title: 'Login',
      error: 'An error occurred during login. Please try again.',
      recaptchaSiteKey: null
    });
  }
});
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/signup', async (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  try {
    const usersExist = await checkIfUsersExist();
    if (!usersExist) {
      return res.redirect('/setup-account');
    }
    
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();
    
    res.render('signup', {
      title: 'Sign Up',
      error: null,
      success: null,
      recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
    });
  } catch (error) {
    console.error('Error loading signup page:', error);
    res.render('signup', {
      title: 'Sign Up',
      error: 'System error. Please try again.',
      success: null,
      recaptchaSiteKey: null
    });
  }
});

app.post('/signup', upload.single('avatar'), async (req, res) => {
  const { username, password, confirmPassword, user_role, status } = req.body;
  const recaptchaResponse = req.body['g-recaptcha-response'];
  
  try {
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();
    
    if (recaptchaSettings.hasKeys && recaptchaSettings.enabled) {
      if (!recaptchaResponse) {
        return res.render('signup', {
          title: 'Sign Up',
          error: 'Please complete the reCAPTCHA verification',
          success: null,
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }
      
      const { decrypt } = require('./utils/encryption');
      const secretKey = decrypt(recaptchaSettings.secretKey);
      
      const axios = require('axios');
      const verifyResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(recaptchaResponse)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      
      if (!verifyResponse.data.success) {
        return res.render('signup', {
          title: 'Sign Up',
          error: 'reCAPTCHA verification failed. Please try again.',
          success: null,
          recaptchaSiteKey: recaptchaSettings.siteKey
        });
      }
    }
    
    if (!username || !password) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Username and password are required',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    if (password !== confirmPassword) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Passwords do not match',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    if (password.length < 6) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Password must be at least 6 characters long',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Username already exists',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }

    let avatarPath = null;
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    const newUser = await User.create({
      username,
      password,
      avatar_path: avatarPath,
      user_role: user_role || 'member',
      status: status || 'inactive'
    });

    if (newUser) {
      return res.render('signup', {
        title: 'Sign Up',
        error: null,
        success: 'Account created successfully! Please wait for admin approval to activate your account.',
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    } else {
      return res.render('signup', {
        title: 'Sign Up',
        error: 'Failed to create account. Please try again.',
        success: null,
        recaptchaSiteKey: recaptchaSettings.hasKeys && recaptchaSettings.enabled ? recaptchaSettings.siteKey : null
      });
    }
  } catch (error) {
    console.error('Signup error:', error);
    return res.render('signup', {
      title: 'Sign Up',
      error: 'An error occurred during registration. Please try again.',
      success: null,
      recaptchaSiteKey: null
    });
  }
});

app.get('/setup-account', async (req, res) => {
  try {
    const usersExist = await checkIfUsersExist();
    if (usersExist && !req.session.userId) {
      return res.redirect('/login');
    }
    if (req.session.userId) {
      const user = await User.findById(req.session.userId);
      if (user && user.username) {
        return res.redirect('/dashboard');
      }
    }
    res.render('setup-account', {
      title: 'Complete Your Account',
      user: req.session.userId ? await User.findById(req.session.userId) : {},
      error: null
    });
  } catch (error) {
    console.error('Setup account error:', error);
    res.redirect('/login');
  }
});
app.post('/setup-account', upload.single('avatar'), [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('confirmPassword')
    .custom((value, { req }) => value === req.body.password)
    .withMessage('Passwords do not match')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.render('setup-account', {
        title: 'Complete Your Account',
        user: { username: req.body.username || '' },
        error: errors.array()[0].msg
      });
    }
    const existingUsername = await User.findByUsername(req.body.username);
    if (existingUsername) {
      return res.render('setup-account', {
        title: 'Complete Your Account',
        user: { email: req.body.email || '' },
        error: 'Username is already taken'
      });
    }
    const avatarPath = req.file ? `/uploads/avatars/${req.file.filename}` : null;
    const usersExist = await checkIfUsersExist();
    if (!usersExist) {
      try {
        const user = await User.create({
          username: req.body.username,
          password: req.body.password,
          avatar_path: avatarPath,
          user_role: 'admin',
          status: 'active'
        });
        req.session.userId = user.id;
        req.session.username = req.body.username;
        req.session.user_role = user.user_role;
        if (avatarPath) {
          req.session.avatar_path = avatarPath;
        }
        console.log('Setup account - Using user ID from database:', user.id);
        console.log('Setup account - Session userId set to:', req.session.userId);
        return res.redirect('/welcome');
      } catch (error) {
        console.error('User creation error:', error);
        return res.render('setup-account', {
          title: 'Complete Your Account',
          user: {},
          error: 'Failed to create user. Please try again.'
        });
      }
    } else {
      await User.update(req.session.userId, {
        username: req.body.username,
        password: req.body.password,
        avatar_path: avatarPath,
      });
      req.session.username = req.body.username;
      if (avatarPath) {
        req.session.avatar_path = avatarPath;
      }
      res.redirect('/dashboard');
    }
  } catch (error) {
    console.error('Account setup error:', error);
    res.render('setup-account', {
      title: 'Complete Your Account',
      user: { email: req.body.email || '' },
      error: 'An error occurred. Please try again.'
    });
  }
});
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});
app.get('/welcome', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user || user.welcome_shown === 1) {
      return res.redirect('/dashboard');
    }
    res.render('welcome', {
      title: 'Welcome'
    });
  } catch (error) {
    console.error('Welcome page error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/welcome-bypass', (req, res) => {
  res.render('welcome', {
    title: 'Welcome'
  });
});
app.get('/welcome/continue', isAuthenticated, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      db.run('UPDATE users SET welcome_shown = 1 WHERE id = ?', [req.session.userId], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Welcome continue error:', error);
    res.redirect('/dashboard');
  }
});
app.get('/analytics', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) { req.session.destroy(); return res.redirect('/login'); }

    const YoutubeChannel = require('./models/YoutubeChannel');
    const allStreams = await Stream.findAll(req.session.userId);
    const allVideos = await Video.findAll(req.session.userId);
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);

    res.render('analytics', {
      title: 'Analytics',
      active: 'analytics',
      user: user,
      totalStreams: allStreams.length,
      totalVideos: allVideos.length,
      youtubeChannels: youtubeChannels
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }
    const YoutubeChannel = require('./models/YoutubeChannel');
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);
    const isYoutubeConnected = youtubeChannels.length > 0;
    const defaultChannel = youtubeChannels.find(c => c.is_default) || youtubeChannels[0];
    
    // Stats
    const allStreams = await Stream.findAll(req.session.userId);
    const liveStreams = allStreams.filter(s => s.status === 'live');
    const allVideos = await Video.findAll(req.session.userId);
    const rotations = await Rotation.findAll(req.session.userId);
    const activeRotations = rotations.filter(r => r.status === 'active');
    
    res.render('overview', {
      title: 'Dashboard',
      active: 'dashboard',
      user: user,
      youtubeConnected: isYoutubeConnected,
      youtubeChannels: youtubeChannels,
      youtubeChannelName: defaultChannel?.channel_name || '',
      youtubeChannelThumbnail: defaultChannel?.channel_thumbnail || '',
      youtubeSubscriberCount: defaultChannel?.subscriber_count || '0',
      totalStreams: allStreams.length,
      liveStreams: liveStreams.length,
      totalVideos: allVideos.length,
      totalRotations: rotations.length,
      activeRotations: activeRotations.length,
      recentStreams: allStreams.slice(0, 5)
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.redirect('/login');
  }
});

// SYSTEM STATS API
app.get('/api/system-stats', isAuthenticated, async (req, res) => {
  try {
    const stats = await systemMonitor.getSystemStats();
    res.json(stats);
  } catch (error) {
    console.error('API /system-stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve system stats' });
  }
});

function normalizeFolderId(folderId) {
  if (folderId === undefined || folderId === null || folderId === '' || folderId === 'root' || folderId === 'null') {
    return null;
  }
  return folderId;
}

async function findLiveStreamConflictsForVideos(userId, videoIds) {
  const targetIds = Array.from(new Set((videoIds || []).filter(Boolean)));
  if (targetIds.length === 0) {
    return [];
  }

  const targetIdSet = new Set(targetIds);
  const liveStreams = await Stream.findAll(userId, 'live');
  const playlistCache = new Map();
  const conflicts = [];

  for (const stream of liveStreams) {
    if (!stream || !stream.video_id) {
      continue;
    }

    if (stream.video_type === 'video') {
      if (targetIdSet.has(stream.video_id)) {
        conflicts.push({
          videoId: stream.video_id,
          streamId: stream.id,
          streamTitle: stream.title || 'Untitled stream'
        });
      }
      continue;
    }

    if (stream.video_type === 'playlist') {
      let playlist = playlistCache.get(stream.video_id);
      if (playlist === undefined) {
        playlist = await Playlist.findByIdWithVideos(stream.video_id);
        playlistCache.set(stream.video_id, playlist || null);
      }

      if (!playlist) {
        continue;
      }

      const playlistItems = [...(playlist.videos || []), ...(playlist.audios || [])];
      for (const item of playlistItems) {
        if (targetIdSet.has(item.id)) {
          conflicts.push({
            videoId: item.id,
            streamId: stream.id,
            streamTitle: stream.title || playlist.name || 'Untitled stream'
          });
        }
      }
    }
  }

  return conflicts;
}

function buildDeleteBlockedMessage(conflicts, videoMap, targetType) {
  if (!conflicts || conflicts.length === 0) {
    return null;
  }

  const firstConflict = conflicts[0];
  const streamTitle = firstConflict.streamTitle || 'Untitled stream';
  const blockedItem = videoMap.get(firstConflict.videoId);
  const blockedItemTitle = blockedItem?.title || 'This file';

  if (targetType === 'folder') {
    return `Cannot delete folder because "${blockedItemTitle}" is currently used by live stream "${streamTitle}". Stop the stream first.`;
  }

  return `Cannot delete file because it is currently used by live stream "${streamTitle}". Stop the stream first.`;
}

app.get('/gallery', isAuthenticated, async (req, res) => {
  try {
    const currentFolderId = normalizeFolderId(req.query.folder);
    const folders = await MediaFolder.findAllByUser(req.session.userId);
    const currentFolder = currentFolderId ? await MediaFolder.findById(currentFolderId, req.session.userId) : null;
    if (currentFolderId && !currentFolder) {
      return res.redirect('/gallery');
    }
    const videos = await Video.findByUserAndFolder(req.session.userId, currentFolderId);
    res.render('gallery', {
      title: 'Video Gallery',
      active: 'gallery',
      user: await User.findById(req.session.userId),
      videos: videos,
      folders: folders,
      currentFolder: currentFolder,
      currentFolderId: currentFolderId || ''
    });
  } catch (error) {
    console.error('Gallery error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/api/gallery/data', isAuthenticated, async (req, res) => {
  try {
    const currentFolderId = normalizeFolderId(req.query.folder);
    const folders = await MediaFolder.findAllByUser(req.session.userId);
    const currentFolder = currentFolderId ? await MediaFolder.findById(currentFolderId, req.session.userId) : null;

    if (currentFolderId && !currentFolder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    const videos = await Video.findByUserAndFolder(req.session.userId, currentFolderId);
    res.json({
      success: true,
      videos,
      folders,
      currentFolder,
      currentFolderId: currentFolderId || ''
    });
  } catch (error) {
    console.error('Gallery data error:', error);
    res.status(500).json({ success: false, error: 'Failed to load gallery data' });
  }
});

app.post('/api/media-folders', isAuthenticated, [
  body('name').trim().notEmpty().withMessage('Folder name is required').isLength({ max: 80 }).withMessage('Folder name is too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }

    const name = req.body.name.trim();
    const existingFolder = await MediaFolder.findByName(req.session.userId, name);
    if (existingFolder) {
      return res.status(400).json({ success: false, error: 'Folder name already exists' });
    }

    const folder = await MediaFolder.create({
      name,
      user_id: req.session.userId
    });

    res.json({ success: true, folder });
  } catch (error) {
    console.error('Error creating media folder:', error);
    res.status(500).json({ success: false, error: 'Failed to create folder' });
  }
});

app.put('/api/media-folders/:id', isAuthenticated, [
  body('name').trim().notEmpty().withMessage('Folder name is required').isLength({ max: 80 }).withMessage('Folder name is too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }

    const folder = await MediaFolder.findById(req.params.id, req.session.userId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    const name = req.body.name.trim();
    const existingFolder = await MediaFolder.findByName(req.session.userId, name);
    if (existingFolder && existingFolder.id !== folder.id) {
      return res.status(400).json({ success: false, error: 'Folder name already exists' });
    }

    await MediaFolder.update(folder.id, req.session.userId, { name });
    res.json({ success: true, message: 'Folder renamed successfully' });
  } catch (error) {
    console.error('Error renaming media folder:', error);
    res.status(500).json({ success: false, error: 'Failed to rename folder' });
  }
});

app.delete('/api/media-folders/:id', isAuthenticated, async (req, res) => {
  try {
    const folder = await MediaFolder.findById(req.params.id, req.session.userId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    const videosInFolder = await Video.findByUserAndFolder(req.session.userId, folder.id);
    const videoMap = new Map(videosInFolder.map(video => [video.id, video]));
    const conflicts = await findLiveStreamConflictsForVideos(req.session.userId, videosInFolder.map(video => video.id));
    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: buildDeleteBlockedMessage(conflicts, videoMap, 'folder')
      });
    }

    for (const video of videosInFolder) {
      await Video.delete(video.id);
    }

    await MediaFolder.delete(folder.id, req.session.userId);
    res.json({ success: true, message: 'Folder deleted successfully' });
  } catch (error) {
    console.error('Error deleting media folder:', error);
    res.status(500).json({ success: false, error: 'Failed to delete folder' });
  }
});

app.put('/api/videos/:id/folder', isAuthenticated, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || video.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }

    await Video.update(req.params.id, { folder_id: folderId });
    res.json({ success: true, folderId });
  } catch (error) {
    console.error('Error moving video to folder:', error);
    res.status(500).json({ success: false, error: 'Failed to move video' });
  }
});
app.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }
    
    const { decrypt } = require('./utils/encryption');
    const YoutubeChannel = require('./models/YoutubeChannel');
    const AppSettings = require('./models/AppSettings');
    const hasYoutubeCredentials = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) || !!(user.youtube_client_id && user.youtube_client_secret);
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);
    const isYoutubeConnected = youtubeChannels.length > 0;
    const defaultChannel = youtubeChannels.find(c => c.is_default) || youtubeChannels[0];
    
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();
    const telegramSettings = await AppSettings.getTelegramSettings();
    
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: user,
      appVersion: packageJson.version,
      youtubeConnected: isYoutubeConnected,
      youtubeChannels: youtubeChannels,
      youtubeChannelName: defaultChannel?.channel_name || '',
      youtubeChannelThumbnail: defaultChannel?.channel_thumbnail || '',
      youtubeSubscriberCount: defaultChannel?.subscriber_count || '0',
      hasYoutubeCredentials: hasYoutubeCredentials,
      youtubeClientId: user.youtube_client_id || process.env.YOUTUBE_CLIENT_ID || '',
      recaptchaSiteKey: recaptchaSettings.siteKey || '',
      recaptchaSecretKey: recaptchaSettings.secretKey ? '••••••••••••••••' : '',
      hasRecaptchaKeys: recaptchaSettings.hasKeys,
      recaptchaEnabled: recaptchaSettings.enabled,
      telegramSettings: telegramSettings,
      success: req.query.success || null,
      error: req.query.error || null,
      activeTab: req.query.activeTab || null
    });
  } catch (error) {
    console.error('Settings error:', error);
    res.redirect('/login');
  }
});
app.get('/history', isAuthenticated, async (req, res) => {
  try {
    const db = require('./db/database').db;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
    const platform = req.query.platform || 'all';
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE h.user_id = ?';
    const params = [req.session.userId];

    if (platform !== 'all') {
      whereClause += ' AND h.platform = ?';
      params.push(platform);
    }

    if (search) {
      whereClause += ' AND h.title LIKE ?';
      params.push(`%${search}%`);
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as count FROM stream_history h ${whereClause}`,
        params,
        (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        }
      );
    });

    const history = await new Promise((resolve, reject) => {
      db.all(
        `SELECT h.*, v.thumbnail_path 
         FROM stream_history h 
         LEFT JOIN videos v ON h.video_id = v.id 
         ${whereClause}
         ORDER BY h.start_time ${sort}
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.render('history', {
      active: 'history',
      title: 'Stream History',
      history: history,
      helpers: app.locals.helpers,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        sort: req.query.sort || 'newest',
        platform,
        search
      }
    });
  } catch (error) {
    console.error('Error fetching stream history:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load stream history',
      error: error
    });
  }
});
app.delete('/api/history/:id', isAuthenticated, async (req, res) => {
  try {
    const db = require('./db/database').db;
    const historyId = req.params.id;
    const history = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM stream_history WHERE id = ? AND user_id = ?',
        [historyId, req.session.userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    if (!history) {
      return res.status(404).json({
        success: false,
        error: 'History entry not found or not authorized'
      });
    }
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM stream_history WHERE id = ?',
        [historyId],
        function (err) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });
    res.json({ success: true, message: 'History entry deleted' });
  } catch (error) {
    console.error('Error deleting history entry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete history entry'
    });
  }
});

app.get('/users', isAdmin, async (req, res) => {
  try {
    const users = await User.findAll();
    
    const usersWithStats = await Promise.all(users.map(async (user) => {
      const videoStats = await new Promise((resolve, reject) => {
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as totalSize 
           FROM videos WHERE user_id = ?`,
          [user.id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
      const streamStats = await new Promise((resolve, reject) => {
         db.get(
           `SELECT COUNT(*) as count FROM streams WHERE user_id = ?`,
           [user.id],
           (err, row) => {
             if (err) reject(err);
             else resolve(row);
           }
         );
       });
       
       const activeStreamStats = await new Promise((resolve, reject) => {
         db.get(
           `SELECT COUNT(*) as count FROM streams WHERE user_id = ? AND status = 'live'`,
           [user.id],
           (err, row) => {
             if (err) reject(err);
             else resolve(row);
           }
         );
       });
      
      const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
      
      return {
         ...user,
         videoCount: videoStats.count,
         totalVideoSize: videoStats.totalSize > 0 ? formatFileSize(videoStats.totalSize) : null,
         streamCount: streamStats.count,
         activeStreamCount: activeStreamStats.count
       };
    }));
    
    res.render('users', {
      title: 'User Management',
      active: 'users',
      users: usersWithStats,
      user: req.user
    });
  } catch (error) {
    console.error('Users page error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load users page',
      user: req.user
    });
  }
});

app.post('/api/users/status', isAdmin, async (req, res) => {
  try {
    const { userId, status } = req.body;
    
    if (!userId || !status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID or status'
      });
    }

    if (userId == req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own status'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.updateStatus(userId, status);
    
    res.json({
      success: true,
      message: `User ${status === 'active' ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

app.post('/api/users/role', isAdmin, async (req, res) => {
  try {
    const { userId, role } = req.body;
    
    if (!userId || !role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID or role'
      });
    }

    if (userId == req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own role'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.updateRole(userId, role);
    
    res.json({
      success: true,
      message: `User role updated to ${role} successfully`
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user role'
    });
  }
});

app.post('/api/users/delete', isAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    if (userId == req.session.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.delete(userId);
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

app.post('/api/users/update', isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const { userId, username, role, status, password, diskLimit } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let avatarPath = user.avatar_path;
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    const updateData = {
      username: username || user.username,
      user_role: role || user.user_role,
      status: status || user.status,
      avatar_path: avatarPath,
      disk_limit: diskLimit !== undefined && diskLimit !== '' ? parseInt(diskLimit) : user.disk_limit
    };

    if (password && password.trim() !== '') {
      const bcrypt = require('bcrypt');
      updateData.password = await bcrypt.hash(password, 10);
    }

    await User.updateProfile(userId, updateData);
    
    res.json({
      success: true,
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

app.post('/api/users/create', isAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const { username, role, status, password, diskLimit } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    let avatarPath = '/uploads/avatars/default-avatar.png';
    if (req.file) {
      avatarPath = `/uploads/avatars/${req.file.filename}`;
    }

    const userData = {
      username: username,
      password: password,
      user_role: role || 'user',
      status: status || 'active',
      avatar_path: avatarPath,
      disk_limit: diskLimit ? parseInt(diskLimit) : 0
    };

    const result = await User.create(userData);
    
    res.json({
      success: true,
      message: 'User created successfully',
      userId: result.id
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
});

app.get('/api/users/:id/videos', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const videos = await Video.findAll(userId);
    res.json({ success: true, videos });
  } catch (error) {
    console.error('Get user videos error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user videos' });
  }
});

app.get('/api/users/:id/streams', isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const streams = await Stream.findAll(userId);
    res.json({ success: true, streams });
  } catch (error) {
    console.error('Get user streams error:', error);
    res.status(500).json({ success: false, message: 'Failed to get user streams' });
  }
});

app.get('/api/user/disk-usage', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const diskUsage = await User.getDiskUsage(req.session.userId);
    res.json({
      success: true,
      diskUsage: diskUsage,
      diskLimit: user.disk_limit || 0
    });
  } catch (error) {
    console.error('Get disk usage error:', error);
    res.status(500).json({ success: false, message: 'Failed to get disk usage' });
  }
});

app.get('/api/system-stats', isAuthenticated, async (req, res) => {
  try {
    const stats = await systemMonitor.getSystemStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  Object.keys(interfaces).forEach((ifname) => {
    interfaces[ifname].forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    });
  });
  return addresses.length > 0 ? addresses : ['localhost'];
}
app.post('/settings/profile', isAuthenticated, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.redirect('/settings?error=' + encodeURIComponent(err.message) + '&activeTab=profile#profile');
    } else if (err) {
      return res.redirect('/settings?error=' + encodeURIComponent(err.message) + '&activeTab=profile#profile');
    }
    next();
  });
}, [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3 and 20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: await User.findById(req.session.userId),
        error: errors.array()[0].msg,
        activeTab: 'profile'
      });
    }
    const currentUser = await User.findById(req.session.userId);
    if (req.body.username !== currentUser.username) {
      const existingUser = await User.findByUsername(req.body.username);
      if (existingUser) {
        return res.render('settings', {
          title: 'Settings',
          active: 'settings',
          user: currentUser,
          error: 'Username is already taken',
          activeTab: 'profile'
        });
      }
    }
    const updateData = {
      username: req.body.username
    };
    if (req.file) {
      updateData.avatar_path = `/uploads/avatars/${req.file.filename}`;
    }
    await User.update(req.session.userId, updateData);
    req.session.username = updateData.username;
    if (updateData.avatar_path) {
      req.session.avatar_path = updateData.avatar_path;
    }
    return res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      success: 'Profile updated successfully!',
      activeTab: 'profile'
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      error: 'An error occurred while updating your profile',
      activeTab: 'profile'
    });
  }
});
app.post('/settings/password', isAuthenticated, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number'),
  body('confirmPassword')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Passwords do not match'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: await User.findById(req.session.userId),
        error: errors.array()[0].msg,
        activeTab: 'security'
      });
    }
    const user = await User.findById(req.session.userId);
    const passwordMatch = await User.verifyPassword(req.body.currentPassword, user.password);
    if (!passwordMatch) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: user,
        error: 'Current password is incorrect',
        activeTab: 'security'
      });
    }
    const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
    await User.update(req.session.userId, { password: hashedPassword });
    return res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      success: 'Password changed successfully',
      activeTab: 'security'
    });
  } catch (error) {
    console.error('Error changing password:', error);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      error: 'An error occurred while changing your password',
      activeTab: 'security'
    });
  }
});

app.get('/api/settings/logs', isAuthenticated, async (req, res) => {
  try {
    const logPath = path.join(__dirname, 'logs', 'app.log');
    const lines = parseInt(req.query.lines) || 200;
    const filter = req.query.filter || '';

    if (!fs.existsSync(logPath)) {
      return res.json({ success: true, logs: [], message: 'Log file not found' });
    }

    const stats = fs.statSync(logPath);
    const fileSize = stats.size;

    const maxReadSize = 5 * 1024 * 1024;
    let content = '';

    if (fileSize > maxReadSize) {
      const fd = fs.openSync(logPath, 'r');
      const buffer = Buffer.alloc(maxReadSize);
      fs.readSync(fd, buffer, 0, maxReadSize, fileSize - maxReadSize);
      fs.closeSync(fd);
      content = buffer.toString('utf8');
      const firstNewline = content.indexOf('\n');
      if (firstNewline > 0) {
        content = content.substring(firstNewline + 1);
      }
    } else {
      content = fs.readFileSync(logPath, 'utf8');
    }

    let logLines = content.split('\n').filter(line => line.trim());

    if (filter) {
      const filterLower = filter.toLowerCase();
      logLines = logLines.filter(line => line.toLowerCase().includes(filterLower));
    }

    logLines = logLines.slice(-lines);

    res.json({ success: true, logs: logLines });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/logs/clear', isAuthenticated, async (req, res) => {
  try {
    const logPath = path.join(__dirname, 'logs', 'app.log');
    fs.writeFileSync(logPath, '');
    res.json({ success: true, message: 'Logs cleared successfully' });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/settings/integrations/gdrive', isAuthenticated, [
  body('apiKey').notEmpty().withMessage('API Key is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('settings', {
        title: 'Settings',
        active: 'settings',
        user: await User.findById(req.session.userId),
        error: errors.array()[0].msg,
        activeTab: 'integrations'
      });
    }
    await User.update(req.session.userId, {
      gdrive_api_key: req.body.apiKey
    });
    return res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      success: 'Google Drive API key saved successfully!',
      activeTab: 'integrations'
    });
  } catch (error) {
    console.error('Error saving Google Drive API key:', error);
    res.render('settings', {
      title: 'Settings',
      active: 'settings',
      user: await User.findById(req.session.userId),
      error: 'An error occurred while saving your Google Drive API key',
      activeTab: 'integrations'
    });
  }
});
app.post('/upload/video', isAuthenticated, uploadVideo.single('video'), async (req, res) => {
  try {
    console.log('Upload request received:', req.file);
    console.log('Session userId for upload:', req.session.userId);
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    const { filename, originalname, path: videoPath, mimetype, size } = req.file;
    const thumbnailName = path.basename(filename, path.extname(filename)) + '.jpg';
    const videoInfo = await getVideoInfo(videoPath);
    const thumbnailRelativePath = await generateThumbnail(videoPath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);
    let format = 'unknown';
    if (mimetype === 'video/mp4') format = 'mp4';
    else if (mimetype === 'video/avi') format = 'avi';
    else if (mimetype === 'video/quicktime') format = 'mov';
    const videoData = {
      title: path.basename(originalname, path.extname(originalname)),
      original_filename: originalname,
      filepath: `/uploads/videos/${filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: size,
      duration: videoInfo.duration,
      format: format,
      user_id: req.session.userId
    };
    const video = await Video.create(videoData);
    res.json({
      success: true,
      video: {
        id: video.id,
        title: video.title,
        filepath: video.filepath,
        thumbnail_path: video.thumbnail_path,
        duration: video.duration,
        file_size: video.file_size,
        format: video.format
      }
    });
  } catch (error) {
    console.error('Upload error details:', error);
    res.status(500).json({ 
      error: 'Failed to upload video',
      details: error.message 
    });
  }
});
app.post('/api/videos/upload', isAuthenticated, (req, res, next) => {
  uploadVideo.single('video')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
          success: false, 
          error: 'File too large. Maximum size is 50GB.' 
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ 
          success: false, 
          error: 'Unexpected file field.' 
        });
      }
      return res.status(400).json({ 
        success: false, 
        error: err.message 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No video file provided' 
      });
    }

    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }

    const user = await User.findById(req.session.userId);
    if (user.disk_limit > 0) {
      const currentUsage = await User.getDiskUsage(req.session.userId);
      const newTotal = currentUsage + req.file.size;
      if (newTotal > user.disk_limit) {
        const fs = require('fs');
        const fullFilePath = path.join(__dirname, 'public', 'uploads', 'videos', req.file.filename);
        if (fs.existsSync(fullFilePath)) {
          fs.unlinkSync(fullFilePath);
        }
        return res.status(400).json({
          success: false,
          error: 'Disk limit exceeded. Please delete some files or contact admin.'
        });
      }
    }

    let title = path.parse(req.file.originalname).name;
    const filePath = `/uploads/videos/${req.file.filename}`;
    const fullFilePath = path.join(__dirname, 'public', filePath);
    const fileSize = req.file.size;
    await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(fullFilePath, (err, metadata) => {
        if (err) {
          console.error('Error extracting metadata:', err);
          return reject(err);
        }
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const duration = metadata.format.duration || 0;
        const format = metadata.format.format_name || '';
        const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : '';
        const bitrate = metadata.format.bit_rate ?
          Math.round(parseInt(metadata.format.bit_rate) / 1000) :
          null;
        let fps = null;
        if (videoStream && videoStream.avg_frame_rate) {
          const fpsRatio = videoStream.avg_frame_rate.split('/');
          if (fpsRatio.length === 2 && parseInt(fpsRatio[1]) !== 0) {
            fps = Math.round((parseInt(fpsRatio[0]) / parseInt(fpsRatio[1]) * 100)) / 100;
          } else {
            fps = parseInt(fpsRatio[0]) || null;
          }
        }
        const thumbnailFilename = `thumb-${path.parse(req.file.filename).name}.jpg`;
        const thumbnailPath = `/uploads/thumbnails/${thumbnailFilename}`;
        const fullThumbnailPath = path.join(__dirname, 'public', thumbnailPath);
        ffmpeg(fullFilePath)
          .screenshots({
            timestamps: ['10%'],
            filename: thumbnailFilename,
            folder: path.join(__dirname, 'public', 'uploads', 'thumbnails'),
            size: '854x480'
          })
          .on('end', async () => {
            try {
              const videoData = {
              title,
              filepath: filePath,
              thumbnail_path: thumbnailPath,
              file_size: fileSize,
              duration,
              format,
              resolution,
              bitrate,
              fps,
              user_id: req.session.userId,
              folder_id: folderId
            };
              const video = await Video.create(videoData);
              res.json({
                success: true,
                message: 'Video uploaded successfully',
                video
              });
              resolve();
            } catch (dbError) {
              console.error('Database error:', dbError);
              reject(dbError);
            }
          })
          .on('error', (err) => {
            console.error('Error creating thumbnail:', err);
            reject(err);
          });
      });
    });
  } catch (error) {
    console.error('Upload error details:', error);
    res.status(500).json({ 
      error: 'Failed to upload video',
      details: error.message 
    });
  }
});
app.get('/api/videos', isAuthenticated, async (req, res) => {
  try {
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const playlists = await Playlist.findAll(req.session.userId);
    res.json({ success: true, videos, playlists });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch videos' });
  }
});

app.post('/api/audio/upload', isAuthenticated, (req, res, next) => {
  uploadAudio.single('audio')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ 
          success: false, 
          error: 'File too large. Maximum size is 50GB.' 
        });
      }
      return res.status(400).json({ 
        success: false, 
        error: err.message 
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No audio file provided' 
      });
    }

    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }

    const user = await User.findById(req.session.userId);
    if (user.disk_limit > 0) {
      const currentUsage = await User.getDiskUsage(req.session.userId);
      const newTotal = currentUsage + req.file.size;
      if (newTotal > user.disk_limit) {
        const uploadedPath = path.join(__dirname, 'public', 'uploads', 'audio', req.file.filename);
        if (fs.existsSync(uploadedPath)) {
          fs.unlinkSync(uploadedPath);
        }
        return res.status(400).json({
          success: false,
          error: 'Disk limit exceeded. Please delete some files or contact admin.'
        });
      }
    }

    let title = path.parse(req.file.originalname).name;
    const uploadedPath = path.join(__dirname, 'public', 'uploads', 'audio', req.file.filename);
    const result = await audioConverter.processAudioFile(uploadedPath, req.file.originalname);
    const finalFilename = path.basename(result.filepath);
    const filePath = `/uploads/audio/${finalFilename}`;
    const fullFilePath = result.filepath;
    const audioInfo = await audioConverter.getAudioInfo(fullFilePath);
    const stats = fs.statSync(fullFilePath);
    const thumbnailPath = '/images/audio-thumbnail.png';
    const videoData = {
      title,
      filepath: filePath,
      thumbnail_path: thumbnailPath,
      file_size: stats.size,
      duration: audioInfo.duration,
      format: 'aac',
      resolution: null,
      bitrate: audioInfo.bitrate,
      fps: null,
      user_id: req.session.userId,
      folder_id: folderId
    };
    const video = await Video.create(videoData);
    res.json({
      success: true,
      message: result.converted ? 'Audio converted to AAC and uploaded successfully' : 'Audio uploaded successfully',
      video,
      converted: result.converted
    });
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload audio',
      details: error.message 
    });
  }
});

app.post('/api/videos/chunk/init', isAuthenticated, async (req, res) => {
  try {
    const { filename, fileSize, totalChunks } = req.body;
    if (!filename || !fileSize || !totalChunks) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }
    const allowedExts = ['.mp4', '.avi', '.mov'];
    const ext = path.extname(filename).toLowerCase();
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ success: false, error: 'Only .mp4, .avi, and .mov formats are allowed' });
    }

    const user = await User.findById(req.session.userId);
    if (user.disk_limit > 0) {
      const currentUsage = await User.getDiskUsage(req.session.userId);
      const newTotal = currentUsage + parseInt(fileSize);
      if (newTotal > user.disk_limit) {
        return res.status(400).json({
          success: false,
          error: 'Disk limit exceeded. Please delete some files or contact admin.'
        });
      }
    }

    const info = await chunkUploadService.initUpload(filename, fileSize, totalChunks, req.session.userId, { folderId });
    res.json({ 
      success: true, 
      uploadId: info.uploadId, 
      chunkSize: chunkUploadService.CHUNK_SIZE,
      uploadedChunks: info.uploadedChunks || [],
      resumed: (info.uploadedChunks || []).length > 0
    });
  } catch (error) {
    console.error('Chunk init error:', error);
    res.status(500).json({ success: false, error: 'Failed to initialize upload' });
  }
});

app.post('/api/videos/chunk/upload', isAuthenticated, express.raw({ type: 'application/octet-stream', limit: '60mb' }), async (req, res) => {
  try {
    const uploadId = req.headers['x-upload-id'];
    const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);
    if (!uploadId || isNaN(chunkIndex)) {
      return res.status(400).json({ success: false, error: 'Missing upload ID or chunk index' });
    }
    const info = await chunkUploadService.getUploadInfo(uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const result = await chunkUploadService.saveChunk(uploadId, chunkIndex, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ success: false, error: 'Failed to upload chunk' });
  }
});

app.get('/api/videos/chunk/status/:uploadId', isAuthenticated, async (req, res) => {
  try {
    const info = await chunkUploadService.getUploadInfo(req.params.uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    res.json({
      success: true,
      uploadedChunks: info.uploadedChunks,
      totalChunks: info.totalChunks,
      status: info.status
    });
  } catch (error) {
    console.error('Chunk status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get upload status' });
  }
});

app.post('/api/videos/chunk/complete', isAuthenticated, async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ success: false, error: 'Missing upload ID' });
    }
    const info = await chunkUploadService.getUploadInfo(uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const result = await chunkUploadService.mergeChunks(uploadId);
    const title = path.parse(info.filename).name;
    const fullFilePath = result.fullPath;
    const videoData = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(fullFilePath, (err, metadata) => {
        if (err) {
          console.error('Error extracting metadata:', err);
          return reject(err);
        }
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const duration = metadata.format.duration || 0;
        const format = metadata.format.format_name || '';
        const resolution = videoStream ? `${videoStream.width}x${videoStream.height}` : '';
        const bitrate = metadata.format.bit_rate ? Math.round(parseInt(metadata.format.bit_rate) / 1000) : null;
        let fps = null;
        if (videoStream && videoStream.avg_frame_rate) {
          const fpsRatio = videoStream.avg_frame_rate.split('/');
          if (fpsRatio.length === 2 && parseInt(fpsRatio[1]) !== 0) {
            fps = Math.round((parseInt(fpsRatio[0]) / parseInt(fpsRatio[1]) * 100)) / 100;
          } else {
            fps = parseInt(fpsRatio[0]) || null;
          }
        }
        const thumbnailFilename = `thumb-${path.parse(result.filename).name}.jpg`;
        const thumbnailPath = `/uploads/thumbnails/${thumbnailFilename}`;
        ffmpeg(fullFilePath)
          .screenshots({
            timestamps: ['10%'],
            filename: thumbnailFilename,
            folder: path.join(__dirname, 'public', 'uploads', 'thumbnails'),
            size: '854x480'
          })
          .on('end', async () => {
            resolve({
              title,
              filepath: result.filepath,
              thumbnail_path: thumbnailPath,
              file_size: result.fileSize,
              duration,
              format,
              resolution,
              bitrate,
              fps,
              user_id: req.session.userId,
              folder_id: info.folderId || null
            });
          })
          .on('error', (err) => {
            console.error('Error creating thumbnail:', err);
            reject(err);
          });
      });
    });
    const video = await Video.create(videoData);
    await chunkUploadService.cleanupUpload(uploadId);
    res.json({ success: true, message: 'Video uploaded successfully', video });
  } catch (error) {
    console.error('Chunk complete error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete upload', details: error.message });
  }
});

app.post('/api/videos/chunk/pause', isAuthenticated, async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ success: false, error: 'Missing upload ID' });
    }
    const info = await chunkUploadService.getUploadInfo(uploadId);
    if (!info) {
      return res.status(404).json({ success: false, error: 'Upload session not found' });
    }
    if (info.userId !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    await chunkUploadService.pauseUpload(uploadId);
    res.json({ success: true });
  } catch (error) {
    console.error('Chunk pause error:', error);
    res.status(500).json({ success: false, error: 'Failed to pause upload' });
  }
});

app.delete('/api/videos/chunk/:uploadId', isAuthenticated, async (req, res) => {
  try {
    const info = await chunkUploadService.getUploadInfo(req.params.uploadId);
    if (info && info.userId === req.session.userId) {
      await chunkUploadService.cleanupUpload(req.params.uploadId);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Chunk cleanup error:', error);
    res.status(500).json({ success: false, error: 'Failed to cleanup upload' });
  }
});
app.delete('/api/videos/:id', isAuthenticated, async (req, res) => {
  try {
    const videoId = req.params.id;
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }
    if (video.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const videoMap = new Map([[video.id, video]]);
    const conflicts = await findLiveStreamConflictsForVideos(req.session.userId, [video.id]);
    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: buildDeleteBlockedMessage(conflicts, videoMap, 'file')
      });
    }

    await Video.delete(videoId);
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ success: false, error: 'Failed to delete video' });
  }
});
app.post('/api/videos/:id/rename', isAuthenticated, [
  body('title').trim().isLength({ min: 1 }).withMessage('Title cannot be empty')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    if (video.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'You don\'t have permission to rename this video' });
    }
    await Video.update(req.params.id, { title: req.body.title });
    res.json({ success: true, message: 'Video renamed successfully' });
  } catch (error) {
    console.error('Error renaming video:', error);
    res.status(500).json({ error: 'Failed to rename video' });
  }
});
app.get('/stream/:videoId', isAuthenticated, async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).send('Video not found');
    }
    if (video.user_id !== req.session.userId) {
      return res.status(403).send('You do not have permission to access this video');
    }
    const videoPath = path.join(__dirname, 'public', video.filepath);
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).send('Error streaming video');
  }
});
app.get('/api/settings/gdrive-status', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    res.json({
      hasApiKey: !!user.gdrive_api_key,
      message: user.gdrive_api_key ? 'Google Drive API key is configured' : 'No Google Drive API key found'
    });
  } catch (error) {
    console.error('Error checking Google Drive API status:', error);
    res.status(500).json({ error: 'Failed to check API key status' });
  }
});
app.post('/api/settings/gdrive-api-key', isAuthenticated, [
  body('apiKey').notEmpty().withMessage('API Key is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg
      });
    }
    await User.update(req.session.userId, {
      gdrive_api_key: req.body.apiKey
    });
    return res.json({
      success: true,
      message: 'Google Drive API key saved successfully!'
    });
  } catch (error) {
    console.error('Error saving Google Drive API key:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving your Google Drive API key'
    });
  }
});

const { encrypt, decrypt } = require('./utils/encryption');

app.post('/api/settings/youtube-credentials', isAuthenticated, [
  body('clientId').notEmpty().withMessage('Client ID is required'),
  body('clientSecret').notEmpty().withMessage('Client Secret is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg
      });
    }

    const { clientId, clientSecret } = req.body;
    
    const encryptedSecret = encrypt(clientSecret);
    
    await User.update(req.session.userId, {
      youtube_client_id: clientId,
      youtube_client_secret: encryptedSecret
    });

    return res.json({
      success: true,
      message: 'YouTube API credentials saved successfully!'
    });
  } catch (error) {
    console.error('Error saving YouTube credentials:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving your YouTube credentials'
    });
  }
});

// ===== AI API Keys endpoints =====
app.get('/api/settings/ai-keys', isAuthenticated, async (req, res) => {
  try {
    const getKey = (key) => new Promise((resolve) => {
      db.get('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key], (err, row) => {
        resolve(row?.setting_value || null);
      });
    });
    const geminiKey = await getKey('ai_gemini_key');
    const openaiKey = await getKey('ai_openai_key');
    res.json({
      success: true,
      geminiKey: geminiKey ? '***' + geminiKey.slice(-4) : null,
      openaiKey: openaiKey ? '***' + openaiKey.slice(-4) : null,
    });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/settings/ai-keys', isAuthenticated, async (req, res) => {
  try {
    const { geminiKey, openaiKey } = req.body;
    const upsert = (key, value) => new Promise((resolve) => {
      if (!value) return resolve();
      db.run(`INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`,
        [key, value], resolve);
    });
    await upsert('ai_gemini_key', geminiKey);
    await upsert('ai_openai_key', openaiKey);
    res.json({ success: true, geminiKey: !!geminiKey, openaiKey: !!openaiKey });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/ai/generate-content', isAuthenticated, async (req, res) => {
  try {
    const { prompt, lang = 'id', style = 'casual' } = req.body;
    if (!prompt) return res.json({ success: false, error: 'Topik tidak boleh kosong' });

    const langMap = { id: 'Bahasa Indonesia', en: 'English', mixed: 'Indonesian and English mixed' };
    const styleMap = { casual: 'casual, friendly, and engaging', professional: 'professional and formal', clickbait: 'clickbait, viral, and attention-grabbing with emojis', educational: 'educational and informative' };
    const langStr = langMap[lang] || 'Bahasa Indonesia';
    const styleStr = styleMap[style] || 'casual';

    const systemPrompt = `You are a YouTube content expert. Generate a YouTube live stream title, description, and tags in ${langStr} with a ${styleStr} tone. 
Topic: "${prompt}"
Respond ONLY with valid JSON in this exact format:
{
  "title": "...",
  "description": "...",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
Title: max 100 chars, compelling.
Description: 3-5 sentences, include hashtags at end.
Tags: 5-10 relevant tags.`;

    // Try Gemini API first — read from DB, fallback to .env
    const getDbKey = (key) => new Promise((resolve) => {
      db.get('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key], (err, row) => {
        resolve(row?.setting_value || null);
      });
    });
    const geminiKey = (await getDbKey('ai_gemini_key')) || process.env.GEMINI_API_KEY;
    const openaiKey = (await getDbKey('ai_openai_key')) || process.env.OPENAI_API_KEY;

    let title, description, tags;

    if (geminiKey) {
      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      });
      if (geminiRes.ok) {
        const gData = await geminiRes.json();
        const text = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        title = parsed.title; description = parsed.description; tags = parsed.tags;
      }
    } else if (openaiKey) {
      const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: systemPrompt }], response_format: { type: 'json_object' } })
      });
      if (oRes.ok) {
        const oData = await oRes.json();
        const parsed = JSON.parse(oData.choices[0].message.content);
        title = parsed.title; description = parsed.description; tags = parsed.tags;
      }
    }

    // Fallback: template-based generation
    if (!title) {
      const styleEmoji = { casual:'🔴', professional:'📺', clickbait:'🔥', educational:'📚' };
      const emoji = styleEmoji[style] || '🔴';
      const now = new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
      title = `${emoji} LIVE ${prompt} | ${now}`;
      description = lang === 'en'
        ? `Join us live for ${prompt}! Don't forget to like, subscribe and hit the notification bell.\n\n📱 Stay connected with us!\n\n#Live #${prompt.replace(/\s+/g,'').substring(0,20)} #YouTube`
        : `Selamat datang di live streaming ${prompt}! Jangan lupa like, subscribe dan aktifkan notifikasi bell.\n\n📱 Ikuti kami terus!\n\n#Live #${prompt.replace(/\s+/g,'').substring(0,20)} #YouTube #LiveStreaming`;
      tags = [prompt, 'live streaming', 'youtube live', 'live', style === 'casual' ? 'santai' : style];
    }

    res.json({ success: true, title, description, tags: Array.isArray(tags) ? tags : [tags] });
  } catch (e) {
    console.error('AI generate error:', e);
    res.json({ success: false, error: e.message || 'Gagal generate konten AI' });
  }
});

app.get('/api/analytics/youtube', isAuthenticated, async (req, res) => {
  try {
    const { period = '28', channelId: reqChannelId } = req.query;
    const user = await User.findById(req.session.userId);
    if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const YoutubeChannel = require('./models/YoutubeChannel');
    const { decrypt } = require('./utils/encryption');
    const channels = await YoutubeChannel.findAll(req.session.userId);

    // Pick requested channel or default
    let selectedChannel = reqChannelId
      ? channels.find(c => c.channel_id === reqChannelId || c.id === reqChannelId)
      : null;
    if (!selectedChannel) selectedChannel = channels.find(c => c.is_default) || channels[0];

    if (!selectedChannel || !selectedChannel.access_token) {
      return res.json({ success: false, error: 'Belum ada channel YouTube terhubung.', noChannel: true });
    }

    const creds = await getYouTubeCredentials(req.session.userId);
    if (!creds) return res.json({ success: false, error: 'Kredensial API belum dikonfigurasi.' });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/auth/youtube/callback`;

    const oauth2Client = getYouTubeOAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
    oauth2Client.setCredentials({
      access_token: decrypt(selectedChannel.access_token),
      refresh_token: selectedChannel.refresh_token ? decrypt(selectedChannel.refresh_token) : null
    });

    const { google } = require('googleapis');
    const ytAnalytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const channelId = selectedChannel.channel_id;
    const channelIds = `channel==${channelId}`;

    const [summaryRes, dailyRes, geoRes, trafficRes, topVideosRes, revenueRes] = await Promise.allSettled([
      ytAnalytics.reports.query({ ids: channelIds, startDate, endDate, metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments' }),
      ytAnalytics.reports.query({ ids: channelIds, startDate, endDate, metrics: 'views,estimatedMinutesWatched', dimensions: 'day', sort: 'day' }),
      ytAnalytics.reports.query({ ids: channelIds, startDate, endDate, metrics: 'views,estimatedMinutesWatched', dimensions: 'country', sort: '-views', maxResults: 10 }),
      ytAnalytics.reports.query({ ids: channelIds, startDate, endDate, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views', maxResults: 10 }),
      ytAnalytics.reports.query({ ids: channelIds, startDate, endDate, metrics: 'views,estimatedMinutesWatched,averageViewDuration', dimensions: 'video', sort: '-views', maxResults: 10 }),
      ytAnalytics.reports.query({ ids: channelIds, startDate, endDate, metrics: 'estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue', dimensions: 'day', sort: 'day' }),
    ]);

    const parseResult = (r) => r.status === 'fulfilled' ? r.value.data : null;
    const summary = parseResult(summaryRes);
    const daily = parseResult(dailyRes);
    const geo = parseResult(geoRes);
    const traffic = parseResult(trafficRes);
    const topVideos = parseResult(topVideosRes);
    const revenue = parseResult(revenueRes);

    if (!summary && summaryRes.reason?.response?.status === 403) {
      return res.json({ success: false, error: 'Akses Analytics ditolak. Harap login ulang akun YouTube untuk mengaktifkan scope Analytics.', needsReauth: true });
    }

    // Calculate total revenue
    const revenueRows = revenue?.rows || [];
    const revHeaders = (revenue?.columnHeaders || []).map(h => h.name);
    const revIdx = revHeaders.indexOf('estimatedRevenue');
    const totalRevenue = revIdx >= 0 ? revenueRows.reduce((s, r) => s + (r[revIdx] || 0), 0) : null;
    const revenueSupported = revenueRes.status === 'fulfilled';

    res.json({
      success: true,
      channelName: selectedChannel.channel_name,
      channelThumbnail: selectedChannel.channel_thumbnail,
      channelId: selectedChannel.channel_id,
      channels: channels.map(c => ({ id: c.id, channelId: c.channel_id, name: c.channel_name, thumbnail: c.channel_thumbnail, isDefault: c.is_default })),
      period, startDate, endDate,
      summary: { rows: summary?.rows || [], headers: (summary?.columnHeaders || []).map(h => h.name) },
      daily: { rows: daily?.rows || [], headers: (daily?.columnHeaders || []).map(h => h.name) },
      geo: { rows: geo?.rows || [], headers: (geo?.columnHeaders || []).map(h => h.name) },
      traffic: { rows: traffic?.rows || [], headers: (traffic?.columnHeaders || []).map(h => h.name) },
      topVideos: { rows: topVideos?.rows || [], headers: (topVideos?.columnHeaders || []).map(h => h.name) },
      revenue: { rows: revenueRows, headers: revHeaders, total: totalRevenue, supported: revenueSupported },
    });
  } catch (error) {
    console.error('YouTube Analytics error:', error);
    const is403 = error?.response?.status === 403;
    res.json({
      success: false,
      error: is403 ? 'Akses Analytics ditolak. Harap login ulang akun YouTube.' : (error.message || 'Gagal mengambil data analytics'),
      needsReauth: is403
    });
  }
});

app.get('/api/settings/youtube-status', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    
    const hasCredentials = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
    const isConnected = !!(user.youtube_access_token && user.youtube_refresh_token);
    
    res.json({
      success: true,
      hasCredentials,
      isConnected,
      channelName: user.youtube_channel_name || null,
      channelId: user.youtube_channel_id || null
    });
  } catch (error) {
    console.error('Error checking YouTube status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check YouTube status' 
    });
  }
});

app.post('/api/settings/youtube-disconnect', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    await YoutubeChannel.deleteAll(req.session.userId);

    return res.json({
      success: true,
      message: 'All YouTube channels disconnected successfully'
    });
  } catch (error) {
    console.error('Error disconnecting YouTube:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect YouTube accounts'
    });
  }
});

app.post('/api/settings/recaptcha', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (user.user_role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only admin can manage reCAPTCHA settings'
      });
    }

    const { siteKey, secretKey, enabled } = req.body;
    
    if (!siteKey) {
      return res.status(400).json({
        success: false,
        error: 'Site Key is required'
      });
    }

    const AppSettings = require('./models/AppSettings');
    const existingSettings = await AppSettings.getRecaptchaSettings();
    
    if (secretKey) {
      const axios = require('axios');
      const verifyResponse = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        `secret=${encodeURIComponent(secretKey)}&response=test`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const verifyData = verifyResponse.data;
      
      if (verifyData['error-codes'] && verifyData['error-codes'].includes('invalid-input-secret')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid reCAPTCHA Secret Key. Please check your credentials.'
        });
      }

      const encryptedSecretKey = encrypt(secretKey);
      await AppSettings.setRecaptchaSettings(siteKey, encryptedSecretKey, enabled);
    } else if (existingSettings.hasKeys) {
      await AppSettings.set('recaptcha_site_key', siteKey);
      await AppSettings.set('recaptcha_enabled', enabled ? '1' : '0');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Secret Key is required'
      });
    }

    return res.json({
      success: true,
      message: 'reCAPTCHA settings saved successfully!'
    });
  } catch (error) {
    console.error('Error saving reCAPTCHA settings:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving reCAPTCHA settings'
    });
  }
});

app.post('/api/settings/recaptcha/toggle', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (user.user_role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only admin can manage reCAPTCHA settings'
      });
    }

    const { enabled } = req.body;
    const AppSettings = require('./models/AppSettings');
    const recaptchaSettings = await AppSettings.getRecaptchaSettings();
    
    if (!recaptchaSettings.hasKeys) {
      return res.status(400).json({
        success: false,
        error: 'Please save reCAPTCHA keys first before enabling'
      });
    }
    
    await AppSettings.set('recaptcha_enabled', enabled ? '1' : '0');

    return res.json({
      success: true,
      message: enabled ? 'reCAPTCHA enabled' : 'reCAPTCHA disabled'
    });
  } catch (error) {
    console.error('Error toggling reCAPTCHA:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reCAPTCHA status'
    });
  }
});

app.delete('/api/settings/recaptcha', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (user.user_role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Only admin can manage reCAPTCHA settings'
      });
    }

    const AppSettings = require('./models/AppSettings');
    await AppSettings.deleteRecaptchaSettings();

    return res.json({
      success: true,
      message: 'reCAPTCHA keys removed successfully'
    });
  } catch (error) {
    console.error('Error removing reCAPTCHA keys:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove reCAPTCHA keys'
    });
  }
});

// ==========================================
// TELEGRAM SETTINGS
// ==========================================
app.post('/api/settings/telegram', isAuthenticated, async (req, res) => {
  try {
    const { token, chatId, enabled, notifyStart, notifyStop, notifyError } = req.body;
    const AppSettings = require('./models/AppSettings');
    
    await AppSettings.setTelegramSettings(
      token || '', 
      chatId || '', 
      enabled === true || enabled === 'true', 
      notifyStart === true || notifyStart === 'true', 
      notifyStop === true || notifyStop === 'true', 
      notifyError === true || notifyError === 'true'
    );
    
    res.json({ success: true, message: 'Telegram settings saved successfully' });
  } catch (error) {
    console.error('Error saving Telegram settings:', error);
    res.status(500).json({ success: false, error: 'Failed to save Telegram settings' });
  }
});

app.post('/api/settings/telegram/test', isAuthenticated, async (req, res) => {
  try {
    const { token, chatId } = req.body;
    if (!token || !chatId) {
      return res.status(400).json({ success: false, error: 'Token and Chat ID are required' });
    }
    
    const fetch = require('node-fetch');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🤖 Test message from LaStream bot. Integration successful!',
        parse_mode: 'HTML'
      })
    });
    
    const data = await response.json();
    if (data.ok) {
      res.json({ success: true, message: 'Test message sent successfully' });
    } else {
      res.status(400).json({ success: false, error: data.description || 'Failed to send test message' });
    }
  } catch (error) {
    console.error('Error testing Telegram bot:', error);
    res.status(500).json({ success: false, error: 'Failed to communicate with Telegram API' });
  }
});

app.get('/api/settings/youtube-channels', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channels = await YoutubeChannel.findAll(req.session.userId);
    res.json({ success: true, channels });
  } catch (error) {
    console.error('Error fetching YouTube channels:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch channels' });
  }
});

app.post('/api/settings/youtube-channel/:id/default', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    await YoutubeChannel.setDefault(req.session.userId, req.params.id);
    res.json({ success: true, message: 'Default channel updated' });
  } catch (error) {
    console.error('Error setting default channel:', error);
    res.status(500).json({ success: false, error: 'Failed to set default channel' });
  }
});

app.delete('/api/settings/youtube-channel/:id', isAuthenticated, async (req, res) => {
  try {
    const YoutubeChannel = require('./models/YoutubeChannel');
    const channel = await YoutubeChannel.findById(req.params.id);
    
    if (!channel || channel.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }
    
    await YoutubeChannel.delete(req.params.id, req.session.userId);
    
    if (channel.is_default) {
      const channels = await YoutubeChannel.findAll(req.session.userId);
      if (channels.length > 0) {
        await YoutubeChannel.setDefault(req.session.userId, channels[0].id);
      }
    }
    
    res.json({ success: true, message: 'Channel disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting channel:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect channel' });
  }
});

const { google } = require('googleapis');

function getYouTubeOAuth2Client(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getYouTubeCredentials(userId) {
  if (userId) {
    try {
      const user = await User.findById(userId);
      if (user && user.youtube_client_id && user.youtube_client_secret) {
        return {
          clientId: user.youtube_client_id,
          clientSecret: decrypt(user.youtube_client_secret)
        };
      }
    } catch (e) {
      console.error('Error getting user youtube credentials:', e);
    }
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

app.get('/auth/youtube', isAuthenticated, async (req, res) => {
  try {
    const creds = await getYouTubeCredentials(req.session.userId);
    if (!creds) {
      return res.redirect('/settings?error=YouTube API credentials not configured. Please set them up in Settings.&activeTab=integration');
    }
    
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/auth/youtube/callback`;
    
    const oauth2Client = getYouTubeOAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
    
    const scopes = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
      'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
    ];
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: req.session.userId
    });
    
    res.redirect(authUrl);
  } catch (error) {
    console.error('YouTube OAuth error:', error);
    res.redirect('/settings?error=Failed to initiate YouTube authentication&activeTab=integration');
  }
});

app.get('/auth/youtube/callback', isAuthenticated, async (req, res) => {
  try {
    const { code, error, state } = req.query;
    
    if (error) {
      console.error('YouTube OAuth error:', error);
      return res.redirect(`/settings?error=${encodeURIComponent(error)}&activeTab=integration`);
    }
    
    if (!code) {
      return res.redirect('/settings?error=No authorization code received&activeTab=integration');
    }
    
    const user = await User.findById(req.session.userId);
    
    const creds = await getYouTubeCredentials(req.session.userId);
    if (!creds) {
      return res.redirect('/settings?error=YouTube API credentials not configured. Please set them up in Settings.&activeTab=integration');
    }
    
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUri = `${protocol}://${host}/auth/youtube/callback`;
    
    const oauth2Client = getYouTubeOAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
    
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });
    
    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      return res.redirect('/settings?error=No YouTube channel found for this account&activeTab=integration');
    }
    
    const channel = channelResponse.data.items[0];
    const channelId = channel.id;
    const channelName = channel.snippet.title;
    const channelThumbnail = channel.snippet.thumbnails?.default?.url || channel.snippet.thumbnails?.medium?.url || '';
    const subscriberCount = channel.statistics?.subscriberCount || '0';
    
    const YoutubeChannel = require('./models/YoutubeChannel');
    const existingChannel = await YoutubeChannel.findByChannelId(req.session.userId, channelId);
    
    if (existingChannel) {
      await YoutubeChannel.update(existingChannel.id, {
        access_token: encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : existingChannel.refresh_token,
        channel_name: channelName,
        channel_thumbnail: channelThumbnail,
        subscriber_count: subscriberCount
      });
    } else {
      await YoutubeChannel.create({
        user_id: req.session.userId,
        channel_id: channelId,
        channel_name: channelName,
        channel_thumbnail: channelThumbnail,
        subscriber_count: subscriberCount,
        access_token: encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null
      });
    }
    
    await User.update(req.session.userId, {
      youtube_redirect_uri: redirectUri
    });
    
    res.redirect('/settings?success=YouTube channel connected successfully&activeTab=integration');
  } catch (error) {
    console.error('YouTube OAuth callback error:', error);
    const errorMessage = error.message || 'Failed to connect YouTube account';
    res.redirect(`/settings?error=${encodeURIComponent(errorMessage)}&activeTab=integration`);
  }
});

app.post('/api/videos/import-drive', isAuthenticated, [
  body('driveUrl').notEmpty().withMessage('Google Drive URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { driveUrl } = req.body;
    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }
    const { extractFileId, downloadFile } = require('./utils/googleDriveService');
    try {
      const fileId = extractFileId(driveUrl);
      const jobId = uuidv4();
      processGoogleDriveImport(jobId, fileId, req.session.userId, folderId)
        .catch(err => console.error('Drive import failed:', err));
      return res.json({
        success: true,
        message: 'Video import started',
        jobId: jobId
      });
    } catch (error) {
      console.error('Google Drive URL parsing error:', error);
      return res.status(400).json({
        success: false,
        error: error.message || 'Format URL Google Drive tidak valid'
      });
    }
  } catch (error) {
    console.error('Error importing from Google Drive:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});
app.get('/api/videos/import-status/:jobId', isAuthenticated, async (req, res) => {
  const jobId = req.params.jobId;
  if (!importJobs[jobId]) {
    return res.status(404).json({ success: false, error: 'Import job not found' });
  }
  return res.json({
    success: true,
    status: importJobs[jobId]
  });
});
const importJobs = {};
async function processGoogleDriveImport(jobId, fileId, userId, folderId = null) {
  const { downloadFile } = require('./utils/googleDriveService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');
  
  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };
  
  try {
    let result;
    try {
      result = await downloadFile(fileId, (progress) => {
        importJobs[jobId] = {
          status: 'downloading',
          progress: progress.progress,
          message: `Downloading ${progress.filename}: ${progress.progress}%`
        };
      });
    } catch (downloadError) {
      importJobs[jobId] = {
        status: 'failed',
        progress: 0,
        message: downloadError.message || 'Failed to download file'
      };
      setTimeout(() => { delete importJobs[jobId]; }, 5 * 60 * 1000);
      return;
    }
    
    if (!result || !result.localFilePath) {
      importJobs[jobId] = {
        status: 'failed',
        progress: 0,
        message: 'Download completed but file path is missing'
      };
      setTimeout(() => { delete importJobs[jobId]; }, 5 * 60 * 1000);
      return;
    }
    
    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };
    
    let videoInfo;
    try {
      videoInfo = await getVideoInfo(result.localFilePath);
    } catch (infoError) {
      videoInfo = { duration: 0 };
    }
    
    let resolution = '';
    let bitrate = null;
    
    try {
      const metadata = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ffprobe timeout')), 30000);
        ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
          clearTimeout(timeout);
          if (err) return reject(err);
          resolve(metadata);
        });
      });
      
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (videoStream) {
        resolution = `${videoStream.width}x${videoStream.height}`;
      }
      
      if (metadata.format && metadata.format.bit_rate) {
        bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
      }
    } catch (probeError) {
      console.log('ffprobe error (non-fatal):', probeError.message);
    }
    
    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    let thumbnailRelativePath = null;
    
    try {
      await generateThumbnail(result.localFilePath, thumbnailName);
      thumbnailRelativePath = `/uploads/thumbnails/${thumbnailName}`;
    } catch (thumbError) {
      console.log('Thumbnail generation failed (non-fatal):', thumbError.message);
    }
    
    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';
    
    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration || 0,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      folder_id: folderId
    };
    
    const video = await Video.create(videoData);
    
    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing Google Drive import:', error.message);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.post('/api/videos/import-mediafire', isAuthenticated, [
  body('mediafireUrl').notEmpty().withMessage('Mediafire URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { mediafireUrl } = req.body;
    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }
    const { extractFileKey } = require('./utils/mediafireService');
    try {
      const fileKey = extractFileKey(mediafireUrl);
      const jobId = uuidv4();
      processMediafireImport(jobId, fileKey, req.session.userId, folderId)
        .catch(err => console.error('Mediafire import failed:', err));
      return res.json({
        success: true,
        message: 'Video import started',
        jobId: jobId
      });
    } catch (error) {
      console.error('Mediafire URL parsing error:', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid Mediafire URL format'
      });
    }
  } catch (error) {
    console.error('Error importing from Mediafire:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});

async function processMediafireImport(jobId, fileKey, userId, folderId = null) {
  const { downloadFile } = require('./utils/mediafireService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');
  
  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };
  
  try {
    const result = await downloadFile(fileKey, (progress) => {
      importJobs[jobId] = {
        status: 'downloading',
        progress: progress.progress,
        message: `Downloading ${progress.filename}: ${progress.progress}%`
      };
    });
    
    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };
    
    const videoInfo = await getVideoInfo(result.localFilePath);
    
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });
    
    let resolution = '';
    let bitrate = null;
    
    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      resolution = `${videoStream.width}x${videoStream.height}`;
    }
    
    if (metadata.format && metadata.format.bit_rate) {
      bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
    }
    
    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    const thumbnailRelativePath = await generateThumbnail(result.localFilePath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);
    
    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';
    
    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      folder_id: folderId
    };
    
    const video = await Video.create(videoData);
    
    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing Mediafire import:', error);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.post('/api/videos/import-dropbox', isAuthenticated, [
  body('dropboxUrl').notEmpty().withMessage('Dropbox URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { dropboxUrl } = req.body;
    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }
    if (!dropboxUrl.includes('dropbox.com')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Dropbox URL format'
      });
    }
    const jobId = uuidv4();
    processDropboxImport(jobId, dropboxUrl, req.session.userId, folderId)
      .catch(err => console.error('Dropbox import failed:', err));
    return res.json({
      success: true,
      message: 'Video import started',
      jobId: jobId
    });
  } catch (error) {
    console.error('Error importing from Dropbox:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});

async function processDropboxImport(jobId, dropboxUrl, userId, folderId = null) {
  const { downloadFile } = require('./utils/dropboxService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');
  
  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };
  
  try {
    const result = await downloadFile(dropboxUrl, (progress) => {
      importJobs[jobId] = {
        status: 'downloading',
        progress: progress.progress,
        message: `Downloading ${progress.filename}: ${progress.progress}%`
      };
    });
    
    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };
    
    const videoInfo = await getVideoInfo(result.localFilePath);
    
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });
    
    let resolution = '';
    let bitrate = null;
    
    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      resolution = `${videoStream.width}x${videoStream.height}`;
    }
    
    if (metadata.format && metadata.format.bit_rate) {
      bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
    }
    
    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    const thumbnailRelativePath = await generateThumbnail(result.localFilePath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);
    
    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';
    
    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      folder_id: folderId
    };
    
    const video = await Video.create(videoData);
    
    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing Dropbox import:', error);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.post('/api/videos/import-mega', isAuthenticated, [
  body('megaUrl').notEmpty().withMessage('MEGA URL is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const { megaUrl } = req.body;
    const folderId = normalizeFolderId(req.body.folderId);
    if (folderId) {
      const folder = await MediaFolder.findById(folderId, req.session.userId);
      if (!folder) {
        return res.status(404).json({ success: false, error: 'Folder not found' });
      }
    }
    if (!megaUrl.includes('mega.nz') && !megaUrl.includes('mega.co.nz')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid MEGA URL format'
      });
    }
    const jobId = uuidv4();
    processMegaImport(jobId, megaUrl, req.session.userId, folderId)
      .catch(err => console.error('MEGA import failed:', err));
    return res.json({
      success: true,
      message: 'Video import started',
      jobId: jobId
    });
  } catch (error) {
    console.error('Error importing from MEGA:', error);
    res.status(500).json({ success: false, error: 'Failed to import video' });
  }
});

async function processMegaImport(jobId, megaUrl, userId, folderId = null) {
  const { downloadFile } = require('./utils/megaService');
  const { getVideoInfo, generateThumbnail } = require('./utils/videoProcessor');
  const ffmpeg = require('fluent-ffmpeg');
  
  importJobs[jobId] = {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...'
  };
  
  try {
    const result = await downloadFile(megaUrl, (progress) => {
      importJobs[jobId] = {
        status: 'downloading',
        progress: progress.progress,
        message: `Downloading ${progress.filename}: ${progress.progress}%`
      };
    });
    
    importJobs[jobId] = {
      status: 'processing',
      progress: 100,
      message: 'Processing video...'
    };
    
    const videoInfo = await getVideoInfo(result.localFilePath);
    
    const metadata = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(result.localFilePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata);
      });
    });
    
    let resolution = '';
    let bitrate = null;
    
    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      resolution = `${videoStream.width}x${videoStream.height}`;
    }
    
    if (metadata.format && metadata.format.bit_rate) {
      bitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000);
    }
    
    const thumbnailBaseName = path.basename(result.filename, path.extname(result.filename));
    const thumbnailName = thumbnailBaseName + '.jpg';
    const thumbnailRelativePath = await generateThumbnail(result.localFilePath, thumbnailName)
      .then(() => `/uploads/thumbnails/${thumbnailName}`)
      .catch(() => null);
    
    let format = path.extname(result.filename).toLowerCase().replace('.', '');
    if (!format) format = 'mp4';
    
    const videoData = {
      title: path.basename(result.filename, path.extname(result.filename)),
      filepath: `/uploads/videos/${result.filename}`,
      thumbnail_path: thumbnailRelativePath,
      file_size: result.fileSize,
      duration: videoInfo.duration,
      format: format,
      resolution: resolution,
      bitrate: bitrate,
      user_id: userId,
      folder_id: folderId
    };
    
    const video = await Video.create(videoData);
    
    importJobs[jobId] = {
      status: 'complete',
      progress: 100,
      message: 'Video imported successfully',
      videoId: video.id
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error processing MEGA import:', error);
    importJobs[jobId] = {
      status: 'failed',
      progress: 0,
      message: error.message || 'Failed to import video'
    };
    setTimeout(() => {
      delete importJobs[jobId];
    }, 5 * 60 * 1000);
  }
}

app.get('/api/stream/videos', isAuthenticated, async (req, res) => {
  try {
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const formattedVideos = videos.map(video => {
      const duration = video.duration ? Math.floor(video.duration) : 0;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      return {
        id: video.id,
        name: video.title,
        thumbnail: video.thumbnail_path,
        resolution: video.resolution || '1280x720',
        duration: formattedDuration,
        url: `/stream/${video.id}`,
        type: 'video'
      };
    });
    res.json(formattedVideos);
  } catch (error) {
    console.error('Error fetching videos for stream:', error);
    res.status(500).json({ error: 'Failed to load videos' });
  }
});

app.get('/api/stream/content', isAuthenticated, async (req, res) => {
  try {
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const formattedVideos = videos.map(video => {
      const duration = video.duration ? Math.floor(video.duration) : 0;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      return {
        id: video.id,
        name: video.title,
        thumbnail: video.thumbnail_path,
        resolution: video.resolution || '1280x720',
        duration: formattedDuration,
        url: `/stream/${video.id}`,
        type: 'video'
      };
    });

    const playlists = await Playlist.findAll(req.session.userId);
    const formattedPlaylists = playlists.map(playlist => {
      return {
        id: playlist.id,
        name: playlist.name,
        thumbnail: '/images/playlist-thumbnail.svg',
        resolution: 'Playlist',
        duration: `${playlist.video_count || 0} videos`,
        videoCount: playlist.video_count || 0,
        audioCount: playlist.audio_count || 0,
        url: `/playlist/${playlist.id}`,
        type: 'playlist',
        description: playlist.description,
        is_shuffle: playlist.is_shuffle
      };
    });

    const allContent = [...formattedPlaylists, ...formattedVideos];
    
    res.json(allContent);
  } catch (error) {
    console.error('Error fetching content for stream:', error);
    res.status(500).json({ error: 'Failed to load content' });
  }
});

app.get('/api/streams', isAuthenticated, async (req, res) => {
  try {
    const filter = req.query.filter;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    if (req.query.page || req.query.limit) {
      const result = await Stream.findAllPaginated(req.session.userId, {
        page,
        limit,
        filter,
        search
      });
      res.json({ success: true, ...result });
    } else {
      const streams = await Stream.findAll(req.session.userId, filter);
      res.json({ success: true, streams });
    }
  } catch (error) {
    console.error('Error fetching streams:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch streams' });
  }
});
app.post('/api/streams', isAuthenticated, [
  body('streamTitle').trim().isLength({ min: 1 }).withMessage('Title is required'),
  body('rtmpUrl').trim().isLength({ min: 1 }).withMessage('RTMP URL is required'),
  body('streamKey').trim().isLength({ min: 1 }).withMessage('Stream key is required')
], async (req, res) => {
  try {
    console.log('Session userId for stream creation:', req.session.userId);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    let platform = 'Custom';
    let platform_icon = 'ti-broadcast';
    if (req.body.rtmpUrl.includes('youtube.com')) {
      platform = 'YouTube';
      platform_icon = 'ti-brand-youtube';
    } else if (req.body.rtmpUrl.includes('facebook.com')) {
      platform = 'Facebook';
      platform_icon = 'ti-brand-facebook';
    } else if (req.body.rtmpUrl.includes('twitch.tv')) {
      platform = 'Twitch';
      platform_icon = 'ti-brand-twitch';
    } else if (req.body.rtmpUrl.includes('tiktok.com')) {
      platform = 'TikTok';
      platform_icon = 'ti-brand-tiktok';
    } else if (req.body.rtmpUrl.includes('instagram.com')) {
      platform = 'Instagram';
      platform_icon = 'ti-brand-instagram';
    } else if (req.body.rtmpUrl.includes('shopee.io')) {
      platform = 'Shopee Live';
      platform_icon = 'ti-brand-shopee';
    } else if (req.body.rtmpUrl.includes('restream.io')) {
      platform = 'Restream.io';
      platform_icon = 'ti-live-photo';
    }
    const streamData = {
      title: req.body.streamTitle,
      video_id: req.body.videoId || null,
      rtmp_url: req.body.rtmpUrl,
      stream_key: req.body.streamKey,
      platform,
      platform_icon,
      bitrate: parseInt(req.body.bitrate) || 2500,
      resolution: req.body.resolution || '1280x720',
      fps: parseInt(req.body.fps) || 30,
      orientation: req.body.orientation || 'horizontal',
      loop_video: req.body.loopVideo === 'true' || req.body.loopVideo === true,
      use_advanced_settings: req.body.useAdvancedSettings === 'true' || req.body.useAdvancedSettings === true,
      user_id: req.session.userId
    };
    const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    function parseLocalDateTime(dateTimeString) {
      const [datePart, timePart] = dateTimeString.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      
      return new Date(year, month - 1, day, hours, minutes);
    }
    
    if (req.body.scheduleStartTime) {
      const scheduleStartDate = parseLocalDateTime(req.body.scheduleStartTime);
      streamData.schedule_time = scheduleStartDate.toISOString();
      streamData.status = 'scheduled';
      
      if (req.body.scheduleEndTime) {
        const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
        
        if (scheduleEndDate <= scheduleStartDate) {
          return res.status(400).json({ 
            success: false, 
            error: 'End time must be after start time' 
          });
        }
        
        streamData.end_time = scheduleEndDate.toISOString();
        const durationMs = scheduleEndDate - scheduleStartDate;
        const durationMinutes = Math.round(durationMs / (1000 * 60));
        streamData.duration = durationMinutes > 0 ? durationMinutes : null;
      }
    } else if (req.body.scheduleEndTime) {
      const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
      streamData.end_time = scheduleEndDate.toISOString();
    }
    
    if (!streamData.status) {
      streamData.status = 'offline';
    }
    const stream = await Stream.create(streamData);
    res.json({ success: true, stream });
  } catch (error) {
    console.error('Error creating stream:', error);
    res.status(500).json({ success: false, error: 'Failed to create stream' });
  }
});

app.post('/api/streams/youtube', isAuthenticated, uploadThumbnail.single('thumbnail'), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const YoutubeChannel = require('./models/YoutubeChannel');
    
    const { videoId, title, description, privacy, category, tags, loopVideo, scheduleStartTime, scheduleEndTime, repeat, ytChannelId, ytMonetization, ytClosedCaptions } = req.body;
    
    let selectedChannel;
    if (ytChannelId) {
      selectedChannel = await YoutubeChannel.findById(ytChannelId);
      if (!selectedChannel || selectedChannel.user_id !== req.session.userId) {
        return res.status(400).json({ success: false, error: 'Invalid channel selected' });
      }
    } else {
      selectedChannel = await YoutubeChannel.findDefault(req.session.userId);
      if (!selectedChannel) {
        const channels = await YoutubeChannel.findAll(req.session.userId);
        selectedChannel = channels[0];
      }
    }
    
    if (!selectedChannel || !selectedChannel.access_token || !selectedChannel.refresh_token) {
      return res.status(400).json({ 
        success: false, 
        error: 'YouTube account not connected. Please connect your YouTube account in Settings.' 
      });
    }
    
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Video is required' });
    }
    
    if (!title) {
      return res.status(400).json({ success: false, error: 'Stream title is required' });
    }
    
    let localThumbnailPath = null;
    if (req.file) {
      try {
        const originalFilename = req.file.filename;
        const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;
        await generateImageThumbnail(req.file.path, thumbFilename);
        localThumbnailPath = `/uploads/thumbnails/${thumbFilename}`;
      } catch (thumbError) {
        console.log('Note: Could not process thumbnail:', thumbError.message);
      }
    }
    
    const streamData = {
      title: title,
      video_id: videoId,
      rtmp_url: '',
      stream_key: '',
      platform: 'YouTube',
      platform_icon: 'ti-brand-youtube',
      bitrate: 4000,
      resolution: '1920x1080',
      fps: 30,
      orientation: 'horizontal',
      loop_video: loopVideo === 'true' || loopVideo === true,
      use_advanced_settings: false,
      user_id: req.session.userId,
      youtube_broadcast_id: null,
      youtube_stream_id: null,
      youtube_description: description || '',
      youtube_privacy: privacy || 'unlisted',
      youtube_category: category || '22',
      youtube_tags: tags || '',
      youtube_thumbnail: localThumbnailPath,
      youtube_channel_id: selectedChannel.id,
      is_youtube_api: true,
      youtube_monetization: ytMonetization === 'true' || ytMonetization === true,
      youtube_closed_captions: ytClosedCaptions === 'true' || ytClosedCaptions === true
    };
    
    if (scheduleStartTime) {
      const [datePart, timePart] = scheduleStartTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const scheduleDate = new Date(year, month - 1, day, hours, minutes);
      streamData.schedule_time = scheduleDate.toISOString();
      streamData.status = 'scheduled';
    } else {
      streamData.status = 'offline';
    }
    
    if (scheduleEndTime) {
      const [datePart, timePart] = scheduleEndTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const endDate = new Date(year, month - 1, day, hours, minutes);
      streamData.end_time = endDate.toISOString();
    }
    
    const stream = await Stream.create(streamData);
    
    res.json({ 
      success: true, 
      stream,
      message: 'Stream created. YouTube broadcast will be created when stream starts.'
    });
  } catch (error) {
    console.error('Error creating YouTube stream:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create YouTube stream' 
    });
  }
});

app.get('/api/streams/:id', isAuthenticated, async (req, res) => {
  try {
    const stream = await Stream.getStreamWithVideo(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized to access this stream' });
    }
    
    if (stream.youtube_broadcast_id) {
      try {
        const user = await User.findById(req.session.userId);
        const creds = await getYouTubeCredentials(req.session.userId);
        if (user.youtube_access_token && creds) {
          const accessToken = decrypt(user.youtube_access_token);
          const refreshToken = decrypt(user.youtube_refresh_token);
          
          const protocol = req.headers['x-forwarded-proto'] || req.protocol;
          const host = req.headers['x-forwarded-host'] || req.get('host');
          const redirectUri = `${protocol}://${host}/auth/youtube/callback`;
          
          const oauth2Client = getYouTubeOAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
          oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          
          const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
          
          const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: stream.youtube_broadcast_id
          });
          
          if (videoResponse.data.items && videoResponse.data.items.length > 0) {
            const thumbnails = videoResponse.data.items[0].snippet.thumbnails;
            stream.youtube_thumbnail = thumbnails.maxres?.url || thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url;
          }
        }
      } catch (ytError) {
        console.log('Note: Could not fetch YouTube thumbnail:', ytError.message);
      }
    }
    
    res.json({ success: true, stream });
  } catch (error) {
    console.error('Error fetching stream:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream' });
  }
});
app.put('/api/streams/:id', isAuthenticated, uploadThumbnail.single('thumbnail'), async (req, res) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this stream' });
    }
    const updateData = {};
    
    function parseScheduleDateTime(dateTimeString) {
      const [datePart, timePart] = dateTimeString.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      return new Date(year, month - 1, day, hours, minutes);
    }
    
    if (req.body.streamMode === 'youtube') {
      if (req.body.title) updateData.title = req.body.title;
      if (req.body.videoId) updateData.video_id = req.body.videoId;
      if (req.body.description !== undefined) updateData.youtube_description = req.body.description;
      if (req.body.privacy) updateData.youtube_privacy = req.body.privacy;
      if (req.body.category) updateData.youtube_category = req.body.category;
      if (req.body.tags !== undefined) updateData.youtube_tags = req.body.tags;
      if (req.body.loopVideo !== undefined) {
        updateData.loop_video = req.body.loopVideo === 'true' || req.body.loopVideo === true;
      }
      if (req.body.ytMonetization !== undefined) {
        updateData.youtube_monetization = req.body.ytMonetization === 'true' || req.body.ytMonetization === true;
      }
      if (req.body.ytClosedCaptions !== undefined) {
        updateData.youtube_closed_captions = req.body.ytClosedCaptions === 'true' || req.body.ytClosedCaptions === true;
      }
      
      if (req.body.scheduleStartTime) {
        const scheduleStartDate = parseScheduleDateTime(req.body.scheduleStartTime);
        updateData.schedule_time = scheduleStartDate.toISOString();
        updateData.status = 'scheduled';
        
        if (req.body.scheduleEndTime) {
          const scheduleEndDate = parseScheduleDateTime(req.body.scheduleEndTime);
          updateData.end_time = scheduleEndDate.toISOString();
        } else if ('scheduleEndTime' in req.body && !req.body.scheduleEndTime) {
          updateData.end_time = null;
        }
      } else if ('scheduleStartTime' in req.body && !req.body.scheduleStartTime) {
        updateData.schedule_time = null;
        if ('scheduleEndTime' in req.body && !req.body.scheduleEndTime) {
          updateData.end_time = null;
        } else if (req.body.scheduleEndTime) {
          const scheduleEndDate = parseScheduleDateTime(req.body.scheduleEndTime);
          updateData.end_time = scheduleEndDate.toISOString();
        }
      }
      
      if (req.file) {
        try {
          const originalFilename = req.file.filename;
          const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;
          await generateImageThumbnail(req.file.path, thumbFilename);
          updateData.youtube_thumbnail = `/uploads/thumbnails/${thumbFilename}`;
        } catch (thumbError) {
          console.log('Note: Could not process thumbnail:', thumbError.message);
        }
      }
      
      if (stream.youtube_broadcast_id) {
        try {
          const user = await User.findById(req.session.userId);
          const creds = await getYouTubeCredentials(req.session.userId);
          if (creds) {
            const YoutubeChannel = require('./models/YoutubeChannel');
            let selectedChannel = await YoutubeChannel.findById(stream.youtube_channel_id);
            if (!selectedChannel) {
              selectedChannel = await YoutubeChannel.findDefault(req.session.userId);
            }
            
            if (selectedChannel && selectedChannel.access_token) {
              const accessToken = decrypt(selectedChannel.access_token);
              const refreshToken = decrypt(selectedChannel.refresh_token);
              
              const protocol = req.headers['x-forwarded-proto'] || req.protocol;
              const host = req.headers['x-forwarded-host'] || req.get('host');
              const redirectUri = `${protocol}://${host}/auth/youtube/callback`;
              
              const oauth2Client = getYouTubeOAuth2Client(creds.clientId, creds.clientSecret, redirectUri);
              oauth2Client.setCredentials({
                access_token: accessToken,
                refresh_token: refreshToken
              });
              
              const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
              
              const broadcastUpdateData = {
                id: stream.youtube_broadcast_id,
                snippet: {
                  title: req.body.title || stream.title,
                  description: req.body.description !== undefined ? req.body.description : (stream.youtube_description || ''),
                  scheduledStartTime: req.body.scheduleStartTime 
                    ? new Date(req.body.scheduleStartTime).toISOString() 
                    : (stream.schedule_time || new Date().toISOString())
                }
              };
              
              const privacyUpdateData = {
                id: stream.youtube_broadcast_id,
                status: {
                  privacyStatus: req.body.privacy || stream.youtube_privacy || 'unlisted'
                }
              };
              
              try {
                await youtube.liveBroadcasts.update({
                  part: 'snippet',
                  requestBody: broadcastUpdateData
                });
              } catch (snippetError) {
                console.log('Note: Could not update broadcast snippet:', snippetError.message);
              }
              
              try {
                await youtube.liveBroadcasts.update({
                  part: 'status',
                  requestBody: privacyUpdateData
                });
              } catch (statusError) {
                console.log('Note: Could not update broadcast status:', statusError.message);
              }

              if (req.body.ytMonetization !== undefined) {
                try {
                  const { syncBroadcastMonetization } = require('./services/youtubeService');
                  const shouldEnableMonetization = req.body.ytMonetization === 'true' || req.body.ytMonetization === true;
                  await syncBroadcastMonetization(youtube, stream.youtube_broadcast_id, shouldEnableMonetization);
                } catch (monetizationError) {
                  console.log('Note: Could not update broadcast monetization:', monetizationError.message);
                  updateData.youtube_monetization = false;
                }
              }
              
              const tagsArray = req.body.tags ? req.body.tags.split(',').map(t => t.trim()).filter(t => t) : [];
              if (tagsArray.length > 0 || req.body.category) {
                try {
                  await youtube.videos.update({
                    part: 'snippet',
                    requestBody: {
                      id: stream.youtube_broadcast_id,
                      snippet: {
                        title: req.body.title || stream.title,
                        description: req.body.description !== undefined ? req.body.description : (stream.youtube_description || ''),
                        categoryId: req.body.category || stream.youtube_category || '22',
                        tags: tagsArray.length > 0 ? tagsArray : undefined
                      }
                    }
                  });
                } catch (videoUpdateError) {
                  console.log('Note: Could not update video metadata:', videoUpdateError.message);
                }
              }
              
              if (req.file && updateData.youtube_thumbnail) {
                try {
                  const thumbnailPath = path.join(__dirname, 'public', updateData.youtube_thumbnail);
                  if (fs.existsSync(thumbnailPath)) {
                    const thumbnailStream = fs.createReadStream(thumbnailPath);
                    await youtube.thumbnails.set({
                      videoId: stream.youtube_broadcast_id,
                      media: {
                        mimeType: 'image/jpeg',
                        body: thumbnailStream
                      }
                    });
                  }
                } catch (thumbError) {
                  console.log('Note: Could not upload thumbnail to YouTube:', thumbError.message);
                }
              }
            }
          }
        } catch (youtubeError) {
          console.log('Note: Could not update YouTube metadata:', youtubeError.message);
        }
      }
      
      await Stream.update(req.params.id, updateData);
      return res.json({ success: true, message: 'Stream updated successfully' });
    }
    
    if (req.body.streamTitle) updateData.title = req.body.streamTitle;
    if (req.body.videoId) updateData.video_id = req.body.videoId;
    
    if (req.body.rtmpUrl) {
      updateData.rtmp_url = req.body.rtmpUrl;
      
      let platform = 'Custom';
      let platform_icon = 'ti-broadcast';
      if (req.body.rtmpUrl.includes('youtube.com')) {
        platform = 'YouTube';
        platform_icon = 'ti-brand-youtube';
      } else if (req.body.rtmpUrl.includes('facebook.com')) {
        platform = 'Facebook';
        platform_icon = 'ti-brand-facebook';
      } else if (req.body.rtmpUrl.includes('twitch.tv')) {
        platform = 'Twitch';
        platform_icon = 'ti-brand-twitch';
      } else if (req.body.rtmpUrl.includes('tiktok.com')) {
        platform = 'TikTok';
        platform_icon = 'ti-brand-tiktok';
      } else if (req.body.rtmpUrl.includes('instagram.com')) {
        platform = 'Instagram';
        platform_icon = 'ti-brand-instagram';
      } else if (req.body.rtmpUrl.includes('shopee.io')) {
        platform = 'Shopee Live';
        platform_icon = 'ti-brand-shopee';
      } else if (req.body.rtmpUrl.includes('restream.io')) {
        platform = 'Restream.io';
        platform_icon = 'ti-live-photo';
      }
      updateData.platform = platform;
      updateData.platform_icon = platform_icon;
    }
    
    if (req.body.streamKey) updateData.stream_key = req.body.streamKey;
    if (req.body.bitrate) updateData.bitrate = parseInt(req.body.bitrate);
    if (req.body.resolution) updateData.resolution = req.body.resolution;
    if (req.body.fps) updateData.fps = parseInt(req.body.fps);
    if (req.body.orientation) updateData.orientation = req.body.orientation;
    if (req.body.loopVideo !== undefined) {
      updateData.loop_video = req.body.loopVideo === 'true' || req.body.loopVideo === true;
    }
    if (req.body.useAdvancedSettings !== undefined) {
      updateData.use_advanced_settings = req.body.useAdvancedSettings === 'true' || req.body.useAdvancedSettings === true;
    }
    const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    function parseLocalDateTime(dateTimeString) {
      const [datePart, timePart] = dateTimeString.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      
      return new Date(year, month - 1, day, hours, minutes);
    }
    
    if (req.body.scheduleStartTime) {
      const scheduleStartDate = parseLocalDateTime(req.body.scheduleStartTime);
      updateData.schedule_time = scheduleStartDate.toISOString();
      updateData.status = 'scheduled';
      
      if (req.body.scheduleEndTime) {
        const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
        
        if (scheduleEndDate <= scheduleStartDate) {
          return res.status(400).json({ 
            success: false, 
            error: 'End time must be after start time' 
          });
        }
        
        updateData.end_time = scheduleEndDate.toISOString();
        const durationMs = scheduleEndDate - scheduleStartDate;
        const durationMinutes = Math.round(durationMs / (1000 * 60));
        updateData.duration = durationMinutes > 0 ? durationMinutes : null;
      } else if ('scheduleEndTime' in req.body && req.body.scheduleEndTime === '') {
        updateData.end_time = null;
        updateData.duration = null;
      }
    } else if ('scheduleStartTime' in req.body && !req.body.scheduleStartTime) {
      updateData.schedule_time = null;
      updateData.status = 'offline';
      
      if (req.body.scheduleEndTime) {
        const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
        updateData.end_time = scheduleEndDate.toISOString();
      } else if ('scheduleEndTime' in req.body && req.body.scheduleEndTime === '') {
        updateData.end_time = null;
        updateData.duration = null;
      }
    } else if (req.body.scheduleEndTime) {
      const scheduleEndDate = parseLocalDateTime(req.body.scheduleEndTime);
      updateData.end_time = scheduleEndDate.toISOString();
    } else if ('scheduleEndTime' in req.body && req.body.scheduleEndTime === '') {
      updateData.end_time = null;
      updateData.duration = null;
    }
    
    const updatedStream = await Stream.update(req.params.id, updateData);
    res.json({ success: true, stream: updatedStream });
  } catch (error) {
    console.error('Error updating stream:', error);
    res.status(500).json({ success: false, error: 'Failed to update stream' });
  }
});
app.delete('/api/streams/:id', isAuthenticated, async (req, res) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this stream' });
    }
    await Stream.delete(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Stream deleted successfully' });
  } catch (error) {
    console.error('Error deleting stream:', error);
    res.status(500).json({ success: false, error: 'Failed to delete stream' });
  }
});
app.post('/api/streams/:id/status', isAuthenticated, [
  body('status').isIn(['live', 'offline', 'scheduled']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    const streamId = req.params.id;
    const stream = await Stream.findById(streamId);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const newStatus = req.body.status;
    if (newStatus === 'live') {
      if (stream.status === 'live') {
        return res.json({
          success: false,
          error: 'Stream is already live',
          stream
        });
      }
      if (streamingService.isStreamStarting(streamId)) {
        return res.status(409).json({
          success: false,
          error: 'Stream start is already in progress'
        });
      }
      if (!stream.video_id) {
        return res.json({
          success: false,
          error: 'No video attached to this stream',
          stream
        });
      }
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const baseUrl = `${protocol}://${host}`;
      const result = await streamingService.startStream(streamId, false, baseUrl);
      if (result.success) {
        const updatedStream = await Stream.getStreamWithVideo(streamId);
        return res.json({
          success: true,
          stream: updatedStream,
          isAdvancedMode: result.isAdvancedMode
        });
      } else {
        return res.status(500).json({
          success: false,
          error: result.error || 'Failed to start stream'
        });
      }
    } else if (newStatus === 'offline') {
      if (stream.status === 'live') {
        const result = await streamingService.stopStream(streamId);
        if (!result.success) {
          console.warn('Failed to stop FFmpeg process:', result.error);
        }
      } else if (stream.status === 'scheduled') {
        await Stream.update(streamId, {
          schedule_time: null,
          end_time: null,
          status: 'offline'
        });
      }
      const result = await Stream.updateStatus(streamId, 'offline', req.session.userId);
      if (!result.updated) {
        return res.status(404).json({
          success: false,
          error: 'Stream not found or not updated'
        });
      }
      return res.json({ success: true, stream: result });
    } else {
      const result = await Stream.updateStatus(streamId, newStatus, req.session.userId);
      if (!result.updated) {
        return res.status(404).json({
          success: false,
          error: 'Stream not found or not updated'
        });
      }
      return res.json({ success: true, stream: result });
    }
  } catch (error) {
    console.error('Error updating stream status:', error);
    res.status(500).json({ success: false, error: 'Failed to update stream status' });
  }
});
app.get('/api/streams/check-key', isAuthenticated, async (req, res) => {
  try {
    const streamKey = req.query.key;
    const excludeId = req.query.excludeId || null;
    if (!streamKey) {
      return res.status(400).json({
        success: false,
        error: 'Stream key is required'
      });
    }
    const isInUse = await Stream.isStreamKeyInUse(streamKey, req.session.userId, excludeId);
    res.json({
      success: true,
      isInUse: isInUse,
      message: isInUse ? 'Stream key is already in use' : 'Stream key is available'
    });
  } catch (error) {
    console.error('Error checking stream key:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check stream key'
    });
  }
});
app.get('/api/streams/:id/logs', isAuthenticated, async (req, res) => {
  try {
    const streamId = req.params.id;
    const stream = await Stream.findById(streamId);
    if (!stream) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }
    if (stream.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    const logs = streamingService.getStreamLogs(streamId);
    const isActive = streamingService.isStreamActive(streamId);
    res.json({
      success: true,
      logs,
      isActive,
      stream
    });
  } catch (error) {
    console.error('Error fetching stream logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stream logs' });
  }
});
app.get('/playlist', isAuthenticated, async (req, res) => {
  try {
    const playlists = await Playlist.findAll(req.session.userId);
    const allVideos = await Video.findAll(req.session.userId);
    const videos = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      if (filepath.includes('/audio/')) return false;
      if (filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3')) return false;
      return true;
    });
    const audios = allVideos.filter(video => {
      const filepath = (video.filepath || '').toLowerCase();
      return filepath.includes('/audio/') || filepath.endsWith('.m4a') || filepath.endsWith('.aac') || filepath.endsWith('.mp3');
    });
    res.render('playlist', {
      title: 'Playlist',
      active: 'playlist',
      user: await User.findById(req.session.userId),
      playlists: playlists,
      videos: videos,
      audios: audios
    });
  } catch (error) {
    console.error('Playlist error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/api/playlists', isAuthenticated, async (req, res) => {
  try {
    const playlists = await Playlist.findAll(req.session.userId);
    
    playlists.forEach(playlist => {
      playlist.shuffle = playlist.is_shuffle;
    });
    
    res.json({ success: true, playlists });
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch playlists' });
  }
});

app.post('/api/playlists', isAuthenticated, [
  body('name').trim().isLength({ min: 1 }).withMessage('Playlist name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlistData = {
      name: req.body.name,
      description: req.body.description || null,
      is_shuffle: req.body.shuffle === 'true' || req.body.shuffle === true,
      user_id: req.session.userId
    };

    const playlist = await Playlist.create(playlistData);
    
    if (req.body.videos && Array.isArray(req.body.videos) && req.body.videos.length > 0) {
      for (let i = 0; i < req.body.videos.length; i++) {
        await Playlist.addVideo(playlist.id, req.body.videos[i], i + 1);
      }
    }

    if (req.body.audios && Array.isArray(req.body.audios) && req.body.audios.length > 0) {
      for (let i = 0; i < req.body.audios.length; i++) {
        await Playlist.addAudio(playlist.id, req.body.audios[i], i + 1);
      }
    }
    
    res.json({ success: true, playlist });
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to create playlist' });
  }
});

app.get('/api/playlists/:id', isAuthenticated, async (req, res) => {
  try {
    const playlist = await Playlist.findByIdWithVideos(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    playlist.shuffle = playlist.is_shuffle;
    
    res.json({ success: true, playlist });
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch playlist' });
  }
});

app.put('/api/playlists/:id', isAuthenticated, [
  body('name').trim().isLength({ min: 1 }).withMessage('Playlist name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const updateData = {
      name: req.body.name,
      description: req.body.description || null,
      is_shuffle: req.body.shuffle === 'true' || req.body.shuffle === true
    };

    const updatedPlaylist = await Playlist.update(req.params.id, updateData);
    
    if (req.body.videos && Array.isArray(req.body.videos)) {
      const existingVideos = await Playlist.findByIdWithVideos(req.params.id);
      if (existingVideos && existingVideos.videos) {
        for (const video of existingVideos.videos) {
          await Playlist.removeVideo(req.params.id, video.id);
        }
      }
      
      for (let i = 0; i < req.body.videos.length; i++) {
        await Playlist.addVideo(req.params.id, req.body.videos[i], i + 1);
      }
    }

    if (req.body.audios && Array.isArray(req.body.audios)) {
      await Playlist.clearAudios(req.params.id);
      for (let i = 0; i < req.body.audios.length; i++) {
        await Playlist.addAudio(req.params.id, req.body.audios[i], i + 1);
      }
    }
    
    res.json({ success: true, playlist: updatedPlaylist });
  } catch (error) {
    console.error('Error updating playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to update playlist' });
  }
});

app.delete('/api/playlists/:id', isAuthenticated, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Playlist.delete(req.params.id);
    res.json({ success: true, message: 'Playlist deleted successfully' });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to delete playlist' });
  }
});

app.post('/api/playlists/:id/videos', isAuthenticated, [
  body('videoId').notEmpty().withMessage('Video ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const video = await Video.findById(req.body.videoId);
    if (!video || video.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const position = await Playlist.getNextPosition(req.params.id);
    await Playlist.addVideo(req.params.id, req.body.videoId, position);
    
    res.json({ success: true, message: 'Video added to playlist' });
  } catch (error) {
    console.error('Error adding video to playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to add video to playlist' });
  }
});

app.delete('/api/playlists/:id/videos/:videoId', isAuthenticated, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Playlist.removeVideo(req.params.id, req.params.videoId);
    res.json({ success: true, message: 'Video removed from playlist' });
  } catch (error) {
    console.error('Error removing video from playlist:', error);
    res.status(500).json({ success: false, error: 'Failed to remove video from playlist' });
  }
});

app.put('/api/playlists/:id/videos/reorder', isAuthenticated, [
  body('videoPositions').isArray().withMessage('Video positions must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) {
      return res.status(404).json({ success: false, error: 'Playlist not found' });
    }
    if (playlist.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Playlist.updateVideoPositions(req.params.id, req.body.videoPositions);
    res.json({ success: true, message: 'Video order updated' });
  } catch (error) {
    console.error('Error reordering videos:', error);
    res.status(500).json({ success: false, error: 'Failed to reorder videos' });
  }
});

app.get('/api/donators', async (req, res) => {
  res.json([]);
});

app.get('/api/server-time', (req, res) => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const formattedTime = `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
  const serverTimezoneOffset = now.getTimezoneOffset();
  res.json({
    serverTime: now.toISOString(),
    formattedTime: formattedTime,
    timezoneOffset: serverTimezoneOffset
  });
});

const Rotation = require('./models/Rotation');
const rotationService = require('./services/rotationService');

app.get('/rotations', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }
    const YoutubeChannel = require('./models/YoutubeChannel');
    const youtubeChannels = await YoutubeChannel.findAll(req.session.userId);
    const hasYoutubeCredentials = !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
    const isYoutubeConnected = youtubeChannels.length > 0;
    const defaultChannel = youtubeChannels.find(c => c.is_default) || youtubeChannels[0];

    const initialStreamsData = await Stream.findAllPaginated(req.session.userId, {
      page: 1,
      limit: 10,
      search: ''
    });

    res.render('dashboard', {
      title: 'Tugas Live',
      active: 'rotations',
      user: user,
      youtubeConnected: isYoutubeConnected,
      youtubeChannels: youtubeChannels,
      youtubeChannelName: defaultChannel?.channel_name || '',
      youtubeChannelThumbnail: defaultChannel?.channel_thumbnail || '',
      youtubeSubscriberCount: defaultChannel?.subscriber_count || '0',
      hasYoutubeCredentials: hasYoutubeCredentials,
      initialStreams: JSON.stringify(initialStreamsData.streams),
      initialPagination: JSON.stringify(initialStreamsData.pagination)
    });
  } catch (error) {
    console.error('Tugas Live page error:', error);
    res.redirect('/dashboard');
  }
});

app.get('/api/rotations', isAuthenticated, async (req, res) => {
  try {
    const rotations = await Rotation.findAll(req.session.userId);
    res.json({ success: true, rotations });
  } catch (error) {
    console.error('Error fetching rotations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rotations' });
  }
});

app.get('/api/rotations/:id', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findByIdWithItems(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    res.json({ success: true, rotation });
  } catch (error) {
    console.error('Error fetching rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rotation' });
  }
});

app.post('/api/rotations', isAuthenticated, uploadThumbnail.any(), async (req, res) => {
  try {
    const { name, repeat_mode, start_time, end_time, items, youtube_channel_id } = req.body;
    
    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    
    if (!name || !parsedItems || parsedItems.length === 0) {
      return res.status(400).json({ success: false, error: 'Name and at least one item are required' });
    }
    
    if (!start_time || !end_time) {
      return res.status(400).json({ success: false, error: 'Start time and end time are required' });
    }
    
    const rotation = await Rotation.create({
      user_id: req.session.userId,
      name,
      is_loop: true,
      start_time,
      end_time,
      repeat_mode: repeat_mode || 'daily',
      youtube_channel_id: youtube_channel_id || null
    });
    
    const uploadedFiles = req.files || [];
    const uploadedFileMap = new Map(
      uploadedFiles.map(file => [file.fieldname, file])
    );
    
    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      const thumbnailFile = uploadedFileMap.get(`thumbnail_${item.thumbnail_upload_index}`);
      
      let thumbnailPath = null;
      let originalThumbnailPath = null;
      if (thumbnailFile && thumbnailFile.size > 0) {
        const originalFilename = thumbnailFile.filename;
        const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;
        
        originalThumbnailPath = originalFilename;
        
        try {
          await generateImageThumbnail(thumbnailFile.path, thumbFilename);
          thumbnailPath = thumbFilename;
        } catch (thumbErr) {
          console.error('Error generating rotation thumbnail:', thumbErr);
          thumbnailPath = originalFilename;
        }
      }
      
      await Rotation.addItem({
        rotation_id: rotation.id,
        order_index: item.order_index,
        video_id: item.video_id,
        title: item.title,
        description: item.description || '',
        tags: item.tags || '',
        thumbnail_path: thumbnailPath,
        original_thumbnail_path: originalThumbnailPath,
        privacy: item.privacy || 'unlisted',
        category: item.category || '22',
        youtube_monetization: item.youtube_monetization === true || item.youtube_monetization === 'true',
        youtube_closed_captions: item.youtube_closed_captions === true || item.youtube_closed_captions === 'true',
        title_alternatives: item.title_alternatives || null
      });
    }
    
    res.json({ success: true, rotation });
  } catch (error) {
    console.error('Error creating rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to create rotation' });
  }
});

app.put('/api/rotations/:id', isAuthenticated, uploadThumbnail.any(), async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    const { name, repeat_mode, start_time, end_time, items, youtube_channel_id } = req.body;
    
    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    
    await Rotation.update(req.params.id, {
      name,
      is_loop: true,
      start_time,
      end_time,
      repeat_mode: repeat_mode || 'daily',
      youtube_channel_id: youtube_channel_id || null
    });
    
    const existingItems = await Rotation.getItemsByRotationId(req.params.id);
    for (const item of existingItems) {
      await Rotation.deleteItem(item.id);
    }
    
    const uploadedFiles = req.files || [];
    const uploadedFileMap = new Map(
      uploadedFiles.map(file => [file.fieldname, file])
    );
    
    for (let i = 0; i < parsedItems.length; i++) {
      const item = parsedItems[i];
      const thumbnailFile = uploadedFileMap.get(`thumbnail_${item.thumbnail_upload_index}`);
      
      let thumbnailPath = item.thumbnail_path && item.thumbnail_path !== 'rotations' ? item.thumbnail_path : null;
      let originalThumbnailPath = item.original_thumbnail_path || null;
      if (thumbnailFile && thumbnailFile.size > 0) {
        const originalFilename = thumbnailFile.filename;
        const thumbFilename = `thumb-${path.parse(originalFilename).name}.jpg`;
        
        originalThumbnailPath = originalFilename;
        
        try {
          await generateImageThumbnail(thumbnailFile.path, thumbFilename);
          thumbnailPath = thumbFilename;
        } catch (thumbErr) {
          console.error('Error generating rotation thumbnail:', thumbErr);
          thumbnailPath = originalFilename;
        }
      }
      
      await Rotation.addItem({
        rotation_id: req.params.id,
        order_index: item.order_index,
        video_id: item.video_id,
        title: item.title,
        description: item.description || '',
        tags: item.tags || '',
        thumbnail_path: thumbnailPath,
        original_thumbnail_path: originalThumbnailPath,
        privacy: item.privacy || 'unlisted',
        category: item.category || '22',
        youtube_monetization: item.youtube_monetization === true || item.youtube_monetization === 'true',
        youtube_closed_captions: item.youtube_closed_captions === true || item.youtube_closed_captions === 'true',
        title_alternatives: item.title_alternatives || null
      });
    }
    
    res.json({ success: true, message: 'Rotation updated' });
  } catch (error) {
    console.error('Error updating rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to update rotation' });
  }
});

app.delete('/api/rotations/:id', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    if (rotation.status === 'active') {
      await rotationService.stopRotation(req.params.id);
    }
    
    await Rotation.delete(req.params.id, req.session.userId);
    res.json({ success: true, message: 'Rotation deleted' });
  } catch (error) {
    console.error('Error deleting rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to delete rotation' });
  }
});

app.post('/api/rotations/:id/activate', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    const result = await rotationService.activateRotation(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error activating rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to activate rotation' });
  }
});

app.post('/api/rotations/:id/pause', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    const result = await rotationService.pauseRotation(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error pausing rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to pause rotation' });
  }
});

app.post('/api/rotations/:id/stop', isAuthenticated, async (req, res) => {
  try {
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    if (rotation.user_id !== req.session.userId) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    
    const result = await rotationService.stopRotation(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error stopping rotation:', error);
    res.status(500).json({ success: false, error: 'Failed to stop rotation' });
  }
});

// =============================================
// AI Content Generator API
// =============================================
app.get('/api/settings/ai', isAuthenticated, async (req, res) => {
  try {
    const AppSettings = require('./models/AppSettings');
    const aiSettings = await AppSettings.getAISettings();
    res.json({ success: true, ...aiSettings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/settings/ai', isAuthenticated, csrfProtection, async (req, res) => {
  try {
    const AppSettings = require('./models/AppSettings');
    const { geminiKey, openaiKey, groqKey, defaultProvider } = req.body;
    await AppSettings.setAISettings(geminiKey, openaiKey, defaultProvider, groqKey);
    res.json({ success: true, message: 'AI settings saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ai/generate', isAuthenticated, async (req, res) => {
  try {
    const { prompt, style, provider, titleCount, refTitle, targetLanguage } = req.body;
    if (!prompt || prompt.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Topik stream terlalu pendek.' });
    }

    const AppSettings = require('./models/AppSettings');
    const aiSettings = await AppSettings.getAISettings();
    let selectedProvider = provider || aiSettings.defaultProvider || 'gemini';

    const numTitles = Math.min(Math.max(parseInt(titleCount) || 3, 1), 10);
    const hasRefTitle = refTitle && refTitle.trim().length > 5;


    // Style & language config
    const styleGuide = {
      casual: 'relaxed, conversational, friendly tone. Use relatable phrasing.',
      professional: 'authoritative, polished, informative tone. No slang. Clear value proposition.',
      clickbait: 'high-energy, emotionally charged, urgency-driven. Use power words. Strategic use of caps and emojis.',
      educational: 'clear, structured, informative. Academic yet accessible.'
    };
    const styleTone = styleGuide[style] || styleGuide.casual;
    
    let outputLang;
    if (targetLanguage && targetLanguage !== 'auto') {
      const langNames = { id: 'Indonesian', en: 'English', es: 'Spanish', ja: 'Japanese', ko: 'Korean', hi: 'Hindi' };
      outputLang = `STRICTLY generate all output (titles, description, and tags) in ${langNames[targetLanguage] || targetLanguage}. Translate the topic if necessary.`;
    } else {
      outputLang = 'Detect the language of the STREAM TOPIC or COMPETITOR REFERENCE TITLE and use the EXACT SAME language for the output (titles, description, and tags). If it is mixed, use a natural mix.';
    }

    let ytResearchText = '';
    try {
      const ytSearch = require('yt-search');
      const searchResult = await ytSearch(prompt);
      const topVideos = searchResult.videos.slice(0, 5);
      if (topVideos.length > 0) {
        const topTitles = topVideos.map((v, i) => `${i + 1}. Title: "${v.title}" | Views: ${v.views} | Age: ${v.ago} | Channel: ${v.author.name}`).join('\\n');
        ytResearchText = `\\n=== LIVE YOUTUBE RESEARCH DATA (TOP RANKING VIDEOS) ===\\nHere are the top 5 currently ranking videos on YouTube for this exact topic:\\n${topTitles}\\n\\nIMPORTANT RESEARCH INSTRUCTION:\\n- ACT AS A DATA ANALYST: Analyze these videos. Which titles have the most views? What keywords are they using? Is the audience preferring older or newer videos?\\n- Based on this data, deduce the winning SEO pattern for this specific topic.\\n- Your generated titles MUST be competitive against these.\\n- Provide a 'researchAnalysis' in your JSON explaining WHY you chose your recommended titles based on this competitor data.\\n========================================================\\n`;
      }
    } catch (err) {
      console.warn('YouTube search failed for AI generation:', err.message);
    }

    const systemPrompt = `You are an elite YouTube SEO specialist with 10+ years of experience, combining expertise from VidIQ, TubeBuddy, and top YouTube content strategists. Your task is to create highly optimized YouTube live stream metadata that maximizes discoverability, CTR (Click-Through Rate), and watch time.

STREAM TOPIC: "${prompt}"
OUTPUT LANGUAGE: ${outputLang}
WRITING STYLE: ${styleTone}
NUMBER OF TITLE VARIANTS: ${numTitles}
${ytResearchText}
${hasRefTitle ? `
=== COMPETITOR TITLE ANALYSIS (HIGHEST PRIORITY) ===
COMPETITOR REFERENCE TITLE: "${refTitle.trim()}"

STEP 1 — ANALYZE this competitor title deeply:
a) KEYWORDS: List every search keyword/phrase used (both primary and secondary)
b) STRUCTURE: Identify the separator pattern (periods, commas, pipes, dashes)
c) STRATEGY: Is it a "keyword chain" style (multiple search phrases connected)?
d) LENGTH: Note the total character count and whether it's long-form or short
e) NICHE SIGNALS: What mood, occasion, use-case does it target? (e.g., "for sleeping", "24/7", "white noise")
f) PROVEN PATTERN: This title likely ranks well — extract the exact formula

STEP 2 — GENERATE ${numTitles} title variants that:
✓ Use the SAME proven keyword-chain structure if that's what the competitor uses
✓ Include the SAME high-performing keywords from analysis (with natural variations)
✓ Target the SAME search intent and use-case (e.g., sleep, relaxation, focus, study)
✓ Are DIFFERENT enough to avoid duplication but follow the same SEO pattern
✓ Each variant should target a slightly different but related search query
✓ If the competitor uses long titles (80-120 chars) — follow that same length strategy
✓ Maintain the same separator style (periods, commas, or pipes) as the competitor

IMPORTANT: The competitor's title structure is PROVEN to work. Replicate its DNA, not just its words.
` : ''}
=== TITLE OPTIMIZATION RULES (CRITICAL - READ CAREFULLY) ===

MANDATORY RULES (apply to ALL titles):
1. KEYWORD FIRST: The PRIMARY keyword from the topic MUST appear in the first 1-3 words
2. LENGTH STRATEGY: Match the length pattern of the top-ranking videos. If competitors use long titles (80-100+ chars) for ambient/sleep/24/7 videos, you MUST also use long titles. Otherwise, use standard 55-65 chars.
3. TONE MATCHING: If the topic is relaxing/sleep/ambient/nature, STRICTLY FORBID clickbait words like "SHOCKING", "VIRAL", "INCREDIBLE". Keep it calm, descriptive, and keyword-rich.
4. NO REPETITION: Every title variant must use a completely different SEO structure/formula
5. SPECIFICITY: Never generic. Replace "great music" with the actual genre/artist/mood
6. SEPARATOR USAGE: Use " | " or " - " or ":" to add secondary keyword naturally. For ambient/sleep videos, you may use commas or periods to chain keywords like competitors.

PROVEN TITLE FORMULA BANK (use DIFFERENT ones for each variant, OR use patterns found in research):
• Formula A — [Primary Keyword] Live ${new Date().getFullYear()} | [Benefit/Hook]
• Formula B — [Artist/Topic]: [Emotional Hook] | Full Live Stream
• Formula C — 🎵 [Primary Keyword] - [Secondary Keyword] | [Platform] Live
• Formula D — [Power Word] [Primary Keyword] Live | [Niche Keyword]
• Formula E — [Number]+ [Topic] Hits Live - [Year] [Genre] Marathon
• Formula F — [Primary Keyword] | [Mood/Occasion] | [Year] Non-Stop Live
• Formula G — [Question format: Who/What Loves] [Primary Keyword]? Watch This Live!

STYLE-SPECIFIC ENHANCEMENT RULES:
${style === 'clickbait' ? `• CLICKBAIT: Capitalize 2-3 KEY words (not all caps entire title)
• Use urgency words: "VIRAL", "TRENDING", "RIGHT NOW", "BREAKING"
• Add 1-2 emojis at start or between words (not at end)
• Example: "🔥 VIRAL Music Hits Leo Rojas | TRENDING Pan Flute Live 2026"` :
style === 'professional' ? `• PROFESSIONAL: No emojis, no ALL CAPS gimmicks
• Use qualifiers: "Official", "HD", "Full Concert", "Remastered", "Exclusive"
• Format: [Artist] - [Title] | Official Live Stream ${new Date().getFullYear()}
• Example: "Leo Rojas & Gheorghe Zamfir | Official Pan Flute Live Concert 2026"` :
style === 'educational' ? `• EDUCATIONAL: Start with "How", "Why", "Learn", "Discover", or a number
• Include the learning outcome in title
• Example: "How Pan Flute Heals Your Soul - Leo Rojas Full Live Experience"` :
`• CASUAL: Conversational, use "&" not "and", include mood descriptors
• Words that work: "Vibes", "Chill", "Relax", "Feel Good", "Nonstop"
• Example: "Chill Pan Flute Vibes 🎵 Leo Rojas & Zamfir | Relax Live 2026"`}

FORBIDDEN WORDS (never use these — they kill CTR):
❌ "Amazing", "Wonderful", "Beautiful", "Great", "Awesome", "Best Ever"
❌ "Check out", "Watch this", "Click here", "You won't believe"
❌ Generic: "Music Video", "Full Video", "Watch Now" (without context)
❌ Repeating the same keyword twice in one title

TITLE QUALITY SELF-CHECK (verify EACH title before outputting):
✓ Does keyword appear in first 3 words? 
✓ Is the length appropriate based on competitor strategy (e.g., long for ambient, 55-65 for standard)?
✓ Does the tone match the intent? (e.g., No "SHOCKING" for relaxing videos!)
✓ Does it tell the viewer EXACTLY what they'll get?
✓ Would a person click this over a competitor's title?
✓ Is it different from all other variants?

=== DESCRIPTION OPTIMIZATION RULES ===
Create a description of 300-500 words with this EXACT structure:
1. HOOK (line 1-2): Start with the main keyword naturally. Make viewer want to stay.
2. WHAT TO EXPECT (3-5 lines): Describe what's in the stream specifically. Use bullet points with •
3. ARTIST/CONTENT INFO (2-4 lines): Background about artist/topic for context & SEO
4. ENGAGEMENT CTA (3-5 lines): Subscribe, like, share with specific reasons why
5. HASHTAGS SECTION (last 3 lines): Add 5 relevant #hashtags naturally integrated

DESCRIPTION RULES:
- First 150 characters are CRITICAL (shown in search preview) — must include main keyword
- Naturally repeat the main keyword 3-4 times throughout (not stuffed)
- Use line breaks between sections for readability

=== TAG OPTIMIZATION RULES ===
Generate exactly 20 tags following this strategic mix:
- 3 BROAD tags: single high-volume keywords (e.g., "live music", "piano music")
- 5 EXACT MATCH tags: the stream topic verbatim and close variations
- 5 LONG-TAIL tags: 3-5 word specific phrases (e.g., "leo rojas pan flute music")
- 4 CONTEXTUAL/LSI tags: semantically related topics (genre, mood, occasion)
- 3 TRENDING tags: current popular search terms in this niche

TAG RULES:
- All lowercase, no # symbol
- Max 500 characters total for all tags combined
- Ordered from most important to least important
- No duplicate meaning across tags

=== SEO SCORING RUBRIC ===
Score 0-100 based on: keyword placement in title (25pts), title CTR formula quality (25pts), description first-150-chars quality (25pts), tag strategic variety (25pts)

=== OUTPUT FORMAT ===
Respond ONLY with this exact JSON (no markdown, no explanation, no text before/after):
{
  "titles": ["title1", "title2", ...],
  "description": "full optimized description here with line breaks using \\n",
  "tags": ["tag1", "tag2", ..., "tag20"],
  "seoScore": 87,
  "seoTips": [
    "Specific actionable tip 1 based on this exact topic",
    "Specific actionable tip 3 based on this exact topic"
  ],
  "researchAnalysis": "Detailed explanation of your research findings and why you recommend the generated titles."
}`;



    const axios = require('axios');
    let result = null;

    // Helper: call Gemini with a specific model
    async function callGemini(model) {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiSettings.geminiKey}`,
        { contents: [{ parts: [{ text: systemPrompt }] }] },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
    }

    // Helper: call OpenAI with a specific model
    async function callOpenAI(model = 'gpt-4o-mini') {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: systemPrompt }],
          temperature: 0.8,
          max_tokens: 800
        },
        {
          headers: { 'Authorization': `Bearer ${aiSettings.openaiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
    }

    // Helper: call Groq (FREE - OpenAI-compatible, Llama 3.1/Mixtral)
    async function callGroq(model = 'llama-3.3-70b-versatile') {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: systemPrompt }],
          temperature: 0.8,
          max_tokens: 800
        },
        {
          headers: { 'Authorization': `Bearer ${aiSettings.groqKey}`, 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleanText);
    }

    // Helper: smart language-aware template fallback (no API needed)
    function templateFallback() {
      const topic = prompt.trim();
      const isEnglish = /^[a-zA-Z\s.,!?'\-\:]+$/.test(topic) && /\b(how|to|in|on|the|and|for|live|stream|music|video|with|by)\b/i.test(topic);
      
      let lang;
      if (targetLanguage === 'en' || targetLanguage === 'id') {
        lang = targetLanguage;
      } else if (targetLanguage && targetLanguage !== 'auto') {
        lang = 'en'; // fallback to English for unsupported languages in template mode
      } else {
        lang = isEnglish ? 'en' : 'id';
      }
      
      const contentStyle = style || 'casual';

      // Extract meaningful keywords from topic
      const stopWordsId = new Set(['dan', 'atau', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'dalam', 'adalah', 'ini', 'itu', 'juga', 'sudah', 'akan', 'bisa', 'ada']);
      const stopWordsEn = new Set(['and', 'or', 'the', 'a', 'an', 'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'is', 'are', 'was', 'be', 'this', 'that', 'it']);
      const stopWords = lang === 'en' ? stopWordsEn : stopWordsId;
      const topicWords = topic.split(/[\s|&,]+/).filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));
      const mainKeywords = topicWords.slice(0, 5).join(' ');
      const shortTopic = topicWords.slice(0, 3).join(' ');

      const year = new Date().getFullYear();

      // Style-specific title patterns per language
      const titleTemplates = {
        en: {
          casual: [
            `🎵 ${topic} | Live Stream ${year}`,
            `${topic} - Full Live Session 🎶`,
            `Live: ${mainKeywords} | Best Music ${year}`
          ],
          professional: [
            `${topic} | Official Live Broadcast ${year}`,
            `Live Performance: ${topic}`,
            `${mainKeywords} - Full Live Concert Stream`
          ],
          clickbait: [
            `🔥 YOU WON'T BELIEVE THIS! ${topic} Live ${year}`,
            `⚡ ${topic} - THE MOST EPIC Live Stream EVER!`,
            `😱 ${mainKeywords} Live | This Will BLOW YOUR MIND!`
          ],
          educational: [
            `📚 ${topic} | Learn & Experience Live`,
            `Understanding ${mainKeywords} - Live Educational Stream`,
            `${topic} - A Complete Live Musical Journey`
          ]
        },
        id: {
          casual: [
            `🎵 ${topic} | Live Stream ${year}`,
            `${topic} - Siaran Langsung Full 🎶`,
            `Live: ${mainKeywords} | Musik Terbaik ${year}`
          ],
          professional: [
            `${topic} | Siaran Langsung Resmi ${year}`,
            `Penampilan Live: ${topic}`,
            `${mainKeywords} - Konser Live Lengkap`
          ],
          clickbait: [
            `🔥 LUAR BIASA! ${topic} Live ${year}`,
            `⚡ ${topic} - SIARAN LIVE PALING EPIC SEPANJANG MASA!`,
            `😱 ${mainKeywords} Live | Dijamin MERINDING Nonton Ini!`
          ],
          educational: [
            `📚 ${topic} | Belajar & Rasakan Langsung`,
            `Mengenal ${mainKeywords} - Siaran Edukatif Live`,
            `${topic} - Perjalanan Musikal Lengkap Live`
          ]
        }
      };

      // Description templates per language
      const descriptions = {
        en: {
          casual: `Welcome to our live stream!\n\nJoin us for an incredible experience featuring ${topic}. Get ready for an unforgettable musical journey that will take you through the best sounds and performances.\n\n🔔 Subscribe and hit the notification bell to never miss a live stream!\n🎵 Share this stream with friends who love great music!\n💬 Drop a comment and let us know what you think!`,
          professional: `Welcome to our official live broadcast.\n\nToday we present ${topic}, a carefully curated live performance experience designed for true music enthusiasts. Our broadcast brings you studio-quality sound and an immersive viewing experience.\n\n📺 Subscribe for regular high-quality live performances.\n🎵 Like and share to support our content.\n💼 For collaboration and business inquiries, contact us via email.`,
          clickbait: `🔥 YOU'VE BEEN WAITING FOR THIS! 🔥\n\nGet ready for the MOST INCREDIBLE live stream of ${topic} you've EVER seen! This is the performance that's going to BREAK THE INTERNET and leave you absolutely speechless!\n\n⚡ SMASH that subscribe button RIGHT NOW!\n🚨 SHARE this before it gets taken down!\n💥 Comment your reaction below — we DARE you!`,
          educational: `Welcome to this educational live session!\n\nToday we explore ${topic}, diving deep into the music, history, and artistry behind this incredible genre. Whether you're a long-time fan or discovering this music for the first time, there's something here for everyone.\n\n📚 Subscribe to learn more through music!\n🎵 Take notes on the techniques and styles you observe.\n💬 Ask questions in the comments — we read every one!`
        },
        id: {
          casual: `Selamat datang di siaran langsung kami!\n\nBergabunglah bersama kami untuk pengalaman luar biasa menampilkan ${topic}. Bersiaplah untuk perjalanan musik yang tak terlupakan yang akan membawa Anda melalui suara dan penampilan terbaik.\n\n🔔 Subscribe dan aktifkan lonceng notifikasi agar tidak ketinggalan siaran live kami!\n🎵 Bagikan siaran ini kepada teman-teman yang suka musik!\n💬 Tinggalkan komentar dan beritahu kami pendapat Anda!`,
          professional: `Selamat datang di siaran langsung resmi kami.\n\nHari ini kami mempersembahkan ${topic}, pengalaman penampilan live yang dikurasi dengan cermat untuk para penikmat musik sejati. Siaran kami menghadirkan suara berkualitas studio dan pengalaman menonton yang imersif.\n\n📺 Subscribe untuk penampilan live berkualitas tinggi secara rutin.\n🎵 Like dan bagikan untuk mendukung konten kami.\n💼 Untuk kolaborasi dan pertanyaan bisnis, hubungi kami melalui email.`,
          clickbait: `🔥 KALIAN SUDAH MENUNGGU INI! 🔥\n\nBersiaplah untuk siaran live ${topic} paling LUAR BIASA yang pernah ada! Ini adalah penampilan yang akan MENGGUNCANG INTERNET dan membuat Anda benar-benar terpesona!\n\n⚡ LANGSUNG klik subscribe SEKARANG JUGA!\n🚨 BAGIKAN sebelum ketinggalan!\n💥 Komentari reaksi Anda di bawah — kami TANTANG Anda!`,
          educational: `Selamat datang di sesi live edukatif ini!\n\nHari ini kita menjelajahi ${topic}, mendalami musik, sejarah, dan seni di balik genre yang luar biasa ini. Baik Anda penggemar lama maupun yang baru mengenal musik ini, ada sesuatu di sini untuk semua orang.\n\n📚 Subscribe untuk terus belajar melalui musik!\n🎵 Perhatikan teknik dan gaya yang Anda amati.\n💬 Ajukan pertanyaan di kolom komentar — kami membaca setiap satu!`
        }
      };

      // Tags per language - no mixing
      const tagSets = {
        en: {
          casual:       [shortTopic, mainKeywords, 'live stream', 'live music', 'full live performance', topic, 'music live', 'youtube live', 'live concert', 'nonstop music'],
          professional: [shortTopic, mainKeywords, 'live broadcast', 'official live', 'live performance', topic, 'professional stream', 'youtube live', 'concert stream', 'hd live music'],
          clickbait:    [shortTopic, mainKeywords, 'viral live stream', 'must watch live', 'epic live', topic, 'live stream 2024', 'youtube live', 'trending music', 'best live performance'],
          educational:  [shortTopic, mainKeywords, 'educational music', 'learn music live', 'music history', topic, 'music appreciation', 'youtube live', 'music education', 'live documentary']
        },
        id: {
          casual:       [shortTopic, mainKeywords, 'siaran langsung', 'musik live', 'penampilan live', topic, 'live streaming', 'youtube live', 'konser live', 'musik nonstop'],
          professional: [shortTopic, mainKeywords, 'siaran resmi', 'live profesional', 'penampilan langsung', topic, 'streaming profesional', 'youtube live', 'konser streaming', 'musik hd'],
          clickbait:    [shortTopic, mainKeywords, 'live viral', 'wajib nonton', 'live epic', topic, 'live stream terbaik', 'youtube live', 'musik trending', 'penampilan terbaik'],
          educational:  [shortTopic, mainKeywords, 'edukasi musik', 'belajar musik', 'sejarah musik', topic, 'apresiasi musik', 'youtube live', 'dokumenter musik', 'live edukatif']
        }
      };

      // SEO tips per language
      const seoTipsMap = {
        en: ['Add more specific keywords to the title for better ranking', 'Expand description to over 300 words for better SEO', 'Include 3-5 relevant hashtags in your description'],
        id: ['Tambahkan kata kunci lebih spesifik di judul agar lebih mudah ditemukan', 'Perluas deskripsi hingga lebih dari 300 kata untuk SEO lebih baik', 'Sertakan 3-5 hashtag relevan di deskripsi Anda']
      };

      const useLang = lang;
      const titles = (titleTemplates[useLang] || titleTemplates.id)[contentStyle] || titleTemplates.id.casual;
      const description = (descriptions[useLang] || descriptions.id)[contentStyle] || descriptions.id.casual;
      const tags = ((tagSets[useLang] || tagSets.id)[contentStyle] || tagSets.id.casual).map(t => t.toLowerCase().trim()).filter(Boolean);
      const seoTips = seoTipsMap[useLang] || seoTipsMap.id;

      const researchAnalysis = useLang === 'en' 
        ? "Because the AI API is currently offline, this is a fallback template generated based on general SEO best practices without live YouTube data."
        : "Karena API AI sedang offline, hasil ini merupakan template otomatis yang dibuat berdasarkan praktik terbaik SEO umum tanpa data YouTube live.";
      return { titles, description, tags, seoScore: 65, seoTips, researchAnalysis };
    }


    // Shared Groq fallback helper (tries multiple models)
    async function tryGroqFallback() {
      const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'];
      for (const m of groqModels) {
        try {
          const r = await callGroq(m);
          if (r) return { result: r, provider: `groq/${m}` };
        } catch (e) {
          console.warn(`Groq ${m} failed, trying next...`);
        }
      }
      return null;
    }

    // Determine available fallbacks
    const tryGroq   = aiSettings.groqKey;
    const tryOpenAI = aiSettings.openaiKey;
    const tryGemini = aiSettings.geminiKey;

    if (selectedProvider === 'gemini') {
      if (!aiSettings.geminiKey) {
        return res.status(400).json({ success: false, error: 'Gemini API Key belum dikonfigurasi. Pergi ke Settings → AI Keys.' });
      }
      // ✅ Waterfall Gemini models
      const geminiModels = ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-pro'];
      let geminiError = null;
      for (const model of geminiModels) {
        try {
          result = await callGemini(model);
          if (result) { selectedProvider = `gemini (${model})`; break; }
        } catch (e) {
          geminiError = e;
          const status = e?.response?.status;
          const errMsg = (e?.response?.data?.error?.message || e.message || '').toLowerCase();
          const isQuota = status === 429 || status === 503 || errMsg.includes('quota') || errMsg.includes('rate') || errMsg.includes('not found');
          if (!isQuota) { break; }
          console.warn(`Gemini ${model} failed (${status}), trying next...`);
        }
      }
      // Fallback chain: OpenAI → Groq → Template
      if (!result && geminiError) {
        if (tryOpenAI) {
          try { result = await callOpenAI('gpt-4o-mini'); selectedProvider = 'openai (auto-fallback)'; }
          catch (e) {
            try { result = await callOpenAI('gpt-3.5-turbo'); selectedProvider = 'openai/gpt-3.5-turbo (auto-fallback)'; }
            catch (e2) { /* continue to groq */ }
          }
        }
        if (!result && tryGroq) {
          const g = await tryGroqFallback();
          if (g) { result = g.result; selectedProvider = `groq (auto-fallback: ${g.provider})`; }
        }
        if (!result) { result = templateFallback(); selectedProvider = 'template (offline)'; }
      }

    } else if (selectedProvider === 'openai') {
      if (!aiSettings.openaiKey) {
        return res.status(400).json({ success: false, error: 'OpenAI API Key belum dikonfigurasi. Pergi ke Settings → AI Keys.' });
      }
      try { result = await callOpenAI('gpt-4o-mini'); }
      catch (e) {
        try { result = await callOpenAI('gpt-3.5-turbo'); selectedProvider = 'openai/gpt-3.5-turbo'; }
        catch (e2) {
          // Fallback chain: Gemini → Groq → Template
          if (tryGemini) {
            try { result = await callGemini('gemini-1.5-flash-latest'); selectedProvider = 'gemini (auto-fallback)'; }
            catch (gErr) { /* continue */ }
          }
          if (!result && tryGroq) {
            const g = await tryGroqFallback();
            if (g) { result = g.result; selectedProvider = `groq (auto-fallback: ${g.provider})`; }
          }
          if (!result) { result = templateFallback(); selectedProvider = 'template (offline)'; }
        }
      }

    } else if (selectedProvider === 'groq') {
      if (!aiSettings.groqKey) {
        return res.status(400).json({ success: false, error: 'Groq API Key belum dikonfigurasi. Pergi ke Settings → AI Keys.' });
      }
      const g = await tryGroqFallback();
      if (g) { result = g.result; selectedProvider = g.provider; }
      else {
        // Fallback: Gemini → OpenAI → Template
        if (tryGemini) {
          try { result = await callGemini('gemini-1.5-flash-latest'); selectedProvider = 'gemini (auto-fallback)'; }
          catch (e) { /* continue */ }
        }
        if (!result && tryOpenAI) {
          try { result = await callOpenAI('gpt-4o-mini'); selectedProvider = 'openai (auto-fallback)'; }
          catch (e) { /* continue */ }
        }
        if (!result) { result = templateFallback(); selectedProvider = 'template (offline)'; }
      }

    } else {
      return res.status(400).json({ success: false, error: 'Provider tidak dikenal.' });
    }

    if (!result || !result.titles) {
      return res.status(500).json({ success: false, error: 'Gagal parse respons AI.' });
    }

    const isOffline = selectedProvider.includes('template');
    res.json({ success: true, provider: selectedProvider, offline: isOffline, ...result });
  } catch (error) {
    console.error('AI Generate error:', error?.response?.data || error.message);
    const errMsg = error?.response?.data?.error?.message || error.message || 'Terjadi kesalahan saat generate.';
    res.status(500).json({ success: false, error: errMsg });
  }
});




// ============================================================
// FEATURE: DYNAMIC OVERLAYS / WATERMARK UPLOAD
// ============================================================
app.post('/api/streams/upload-watermark', isAuthenticated, uploadThumbnail.single('watermark'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No watermark file uploaded' });
    }
    const watermarkPath = `/uploads/thumbnails/${req.file.filename}`;
    res.json({ success: true, watermarkPath });
  } catch (error) {
    console.error('Watermark upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: SCHEDULE PAGE
// ============================================================
app.get('/schedule', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) { req.session.destroy(); return res.redirect('/login'); }

    const allStreams = await Stream.findAll(req.session.userId, 'scheduled');
    const Rotation = require('./models/Rotation');
    const rotations = await Rotation.findAll(req.session.userId);
    const activeRotations = rotations.filter(r => r.status === 'active' || r.status === 'paused');

    res.render('schedule', {
      title: 'Jadwal Stream',
      active: 'schedule',
      user,
      scheduledStreams: allStreams,
      rotations: activeRotations
    });
  } catch (error) {
    console.error('Schedule page error:', error);
    res.redirect('/dashboard');
  }
});

// ============================================================
// FEATURE: UPCOMING STREAMS API
// ============================================================
app.get('/api/schedule/upcoming', isAuthenticated, async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const streams = await Stream.findScheduledUpcoming(req.session.userId, hours);
    res.json({ success: true, streams });
  } catch (error) {
    console.error('Upcoming streams API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: STREAM DUPLICATE
// ============================================================
app.post('/api/streams/:id/duplicate', isAuthenticated, async (req, res) => {
  try {
    const result = await Stream.duplicate(req.params.id, req.session.userId);
    res.json({ success: true, stream: result });
  } catch (error) {
    console.error('Stream duplicate error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: STREAM RESTART
// ============================================================
app.post('/api/streams/:id/restart', isAuthenticated, async (req, res) => {
  try {
    const stream = await Stream.findById(req.params.id);
    if (!stream || stream.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Stream not found' });
    }

    // Stop if currently live
    if (stream.status === 'live') {
      await streamingService.stopStream(stream.id);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Start stream
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 7575}`;
    const result = await streamingService.startStream(stream.id, false, baseUrl);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Stream restart error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: BULK STREAM ACTIONS
// ============================================================
app.post('/api/streams/bulk-action', isAuthenticated, async (req, res) => {
  try {
    const { action, ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No streams selected' });
    }

    if (action === 'delete') {
      const result = await Stream.bulkDelete(ids, req.session.userId);
      return res.json({ success: true, deleted: result.deleted });
    }

    if (action === 'stop') {
      let stopped = 0;
      for (const id of ids) {
        const stream = await Stream.findById(id);
        if (stream && stream.user_id === req.session.userId && stream.status === 'live') {
          try {
            await streamingService.stopStream(id);
            stopped++;
          } catch (e) {
            console.error(`Bulk stop error for ${id}:`, e.message);
          }
        }
      }
      return res.json({ success: true, stopped });
    }

    res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: ROTATION LOGS API
// ============================================================
app.get('/api/rotations/:id/logs', isAuthenticated, async (req, res) => {
  try {
    const Rotation = require('./models/Rotation');
    const RotationLog = require('./models/RotationLog');
    const rotation = await Rotation.findById(req.params.id);
    if (!rotation || rotation.user_id !== req.session.userId) {
      return res.status(404).json({ success: false, error: 'Rotation not found' });
    }
    const logs = await RotationLog.findByRotationId(req.params.id, 100);
    const stats = await RotationLog.getStats(req.params.id);
    res.json({ success: true, logs, stats });
  } catch (error) {
    console.error('Rotation logs API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: ANALYTICS STREAM STATS
// ============================================================
app.get('/api/analytics/stream-stats', isAuthenticated, async (req, res) => {
  try {
    const allStreams = await Stream.findAll(req.session.userId);
    const liveStreams = allStreams.filter(s => s.status === 'live');
    const scheduledStreams = allStreams.filter(s => s.status === 'scheduled');
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayStr = todayStart.toISOString();

    // Count today's streams from history
    const { db } = require('./db/database');
    const todayCount = await new Promise((resolve) => {
      db.get(
        `SELECT COUNT(*) as count FROM stream_history WHERE user_id = ? AND start_time >= ?`,
        [req.session.userId, todayStr],
        (err, row) => resolve(row ? row.count : 0)
      );
    });

    const historyData = await Stream.getStreamHistory(req.session.userId, 30);

    res.json({
      success: true,
      live: liveStreams.length,
      scheduled: scheduledStreams.length,
      total: allStreams.length,
      todayStreams: todayCount,
      historyData
    });
  } catch (error) {
    console.error('Stream stats API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// FEATURE: EXPORT STREAM HISTORY CSV
// ============================================================
app.get('/api/analytics/export-csv', isAuthenticated, async (req, res) => {
  try {
    const { db } = require('./db/database');
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT title, platform, start_time, end_time, duration, resolution, bitrate, fps
         FROM stream_history
         WHERE user_id = ?
         ORDER BY start_time DESC
         LIMIT 1000`,
        [req.session.userId],
        (err, rows) => { if (err) reject(err); else resolve(rows || []); }
      );
    });

    const headers = ['Judul', 'Platform', 'Waktu Mulai', 'Waktu Selesai', 'Durasi (detik)', 'Resolusi', 'Bitrate', 'FPS'];
    const csvRows = rows.map(r => [
      `"${(r.title || '').replace(/"/g, '""')}"`,
      r.platform || '',
      r.start_time || '',
      r.end_time || '',
      r.duration || '',
      r.resolution || '',
      r.bitrate || '',
      r.fps || ''
    ].join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="stream-history-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel compatibility
  } catch (error) {
    console.error('Export CSV error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================

const server = app.listen(port, '0.0.0.0', async () => {
  try {
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
  
  const ipAddresses = getLocalIpAddresses();
  console.log(`LaStream running at:`);
  if (ipAddresses && ipAddresses.length > 0) {
    ipAddresses.forEach(ip => {
      console.log(`  http://${ip}:${port}`);
    });
  } else {
    console.log(`  http://localhost:${port}`);
  }
  try {
    const streams = await Stream.findAll(null, 'live');
    if (streams && streams.length > 0) {
      console.log(`Resetting ${streams.length} live streams to offline state...`);
      for (const stream of streams) {
        await Stream.updateStatus(stream.id, 'offline');
      }
    }
  } catch (error) {
    console.error('Error resetting stream statuses:', error);
  }
  schedulerService.init(streamingService);
  rotationService.init();
  try {
    await streamingService.syncStreamStatuses();
  } catch (error) {
    console.error('Failed to sync stream statuses:', error);
  }
});

server.timeout = 30 * 60 * 1000;
server.keepAliveTimeout = 30 * 60 * 1000;
server.headersTimeout = 30 * 60 * 1000;

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  schedulerService.shutdown();
  await streamingService.gracefulShutdown();
  rotationService.shutdown();
  process.exit(1);
});
