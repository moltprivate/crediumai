const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');

const app = express();

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://syjlapnrysfqagpcnwsd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CORS
app.use(cors({
  origin: ['http://localhost:3000', 'https://crediumai.com', 'https://*.vercel.app']
}));

app.use(express.json({ limit: '50kb' }));

// ============================================
// RATE LIMITING (Simple in-memory)
// ============================================
const rateLimit = new Map();

const checkRateLimit = (identifier, action, maxRequests = 10, windowMs = 3600000) => {
  const key = `${identifier}:${action}`;
  const now = Date.now();
  
  if (!rateLimit.has(key)) {
    rateLimit.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  const record = rateLimit.get(key);
  
  // Reset after window
  if (now - record.firstAttempt > windowMs) {
    rateLimit.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  if (record.count >= maxRequests) {
    const retryAfter = Math.ceil((record.firstAttempt + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  record.count++;
  return { allowed: true, remaining: maxRequests - record.count };
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required. Provide Bearer token.' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Auth error:', error);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or expired token' 
      });
    }
    
    // Attach user to request
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
};

// ============================================
// PROFILE OWNERSHIP VERIFICATION
// ============================================
const verifyAgentOwnership = async (agentId, userId) => {
  const { data: agent, error } = await supabase
    .from('agent_profiles')
    .select('user_id')
    .eq('id', agentId)
    .single();
  
  if (error || !agent) {
    return { valid: false, error: 'Agent not found' };
  }
  
  if (agent.user_id !== userId) {
    return { valid: false, error: 'Not authorized for this agent' };
  }
  
  return { valid: true };
};

// ============================================
// STATIC FILES
// ============================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// PUBLIC API ROUTES (No auth required)
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    secure: true 
  });
});

// Public leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('agent_leaderboard')
      .select('*')
      .limit(50);
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get agent details (public if agent is public)
app.get('/api/agents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: profile, error: profileError } = await supabase
      .from('agent_profiles')
      .select('*')
      .eq('id', id)
      .single();
    
    if (profileError) throw profileError;
    
    // Check if public or owner (if auth header provided)
    const authHeader = req.headers.authorization;
    let isOwner = false;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);
      isOwner = user && user.id === profile.user_id;
    }
    
    if (!profile.public && !isOwner) {
      return res.status(403).json({ 
        success: false, 
        error: 'This agent profile is private' 
      });
    }
    
    const { data: activity, error: activityError } = await supabase
      .from('agent_activity')
      .select('*')
      .eq('agent_profile_id', id)
      .order('session_date', { ascending: false })
      .limit(30);
    
    if (activityError) throw activityError;
    
    const { data: badges, error: badgesError } = await supabase
      .from('agent_badges')
      .select('*')
      .eq('agent_profile_id', id)
      .order('earned_at', { ascending: false });
    
    if (badgesError) throw badgesError;
    
    res.json({
      success: true,
      data: { profile, activity, badges },
      is_owner: isOwner
    });
  } catch (err) {
    console.error('Agent fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// PROTECTED API ROUTES (Auth required)
// ============================================

// Create agent profile (authenticated users only)
app.post('/api/agents', requireAuth, async (req, res) => {
  try {
    // Rate limit: 3 agents per hour per user
    const rateCheck = checkRateLimit(req.user.id, 'create_agent', 3, 3600000);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Try again later.',
        retry_after: rateCheck.retryAfter
      });
    }
    
    const { agent_name, description, skills, platforms } = req.body;
    
    // Validation
    if (!agent_name || typeof agent_name !== 'string') {
      return res.status(400).json({ success: false, error: 'Agent name is required' });
    }
    
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ success: false, error: 'Description is required' });
    }
    
    // Sanitize inputs
    const cleanName = agent_name.trim().slice(0, 100);
    const cleanDesc = description.trim().slice(0, 500);
    
    if (cleanName.length < 2) {
      return res.status(400).json({ success: false, error: 'Agent name too short' });
    }
    
    // CRITICAL: Force user_id to authenticated user
    const { data, error } = await supabase
      .from('agent_profiles')
      .insert([{ 
        user_id: req.user.id,
        agent_name: cleanName, 
        description: cleanDesc, 
        skills: Array.isArray(skills) ? skills.slice(0, 20) : [], 
        platforms: Array.isArray(platforms) ? platforms.slice(0, 10) : [],
        verified: false,
        public: true
      }])
      .select();
    
    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }
    
    res.json({ 
      success: true, 
      data: data[0],
      rate_limit: { remaining: rateCheck.remaining }
    });
  } catch (err) {
    console.error('Create agent error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Log agent activity (authenticated + ownership verified)
app.post('/api/activity', requireAuth, async (req, res) => {
  try {
    // Rate limit: 20 activity logs per hour per user
    const rateCheck = checkRateLimit(req.user.id, 'log_activity', 20, 3600000);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Try again later.',
        retry_after: rateCheck.retryAfter
      });
    }
    
    const { agent_profile_id, tasks_completed, success_rate, channels_used, top_skills } = req.body;
    
    if (!agent_profile_id) {
      return res.status(400).json({ success: false, error: 'Agent profile ID is required' });
    }
    
    // CRITICAL: Verify the agent belongs to the authenticated user
    const ownership = await verifyAgentOwnership(agent_profile_id, req.user.id);
    if (!ownership.valid) {
      return res.status(403).json({ success: false, error: ownership.error });
    }
    
    // Validate inputs
    const tasks = parseInt(tasks_completed) || 0;
    const rate = parseFloat(success_rate);
    const validRate = !isNaN(rate) && rate >= 0 && rate <= 100 ? rate : null;
    
    if (tasks < 0 || tasks > 10000) {
      return res.status(400).json({ success: false, error: 'Invalid task count' });
    }
    
    const { data, error } = await supabase
      .from('agent_activity')
      .insert([{ 
        agent_profile_id,
        tasks_completed: tasks,
        success_rate: validRate,
        channels_used: Array.isArray(channels_used) ? channels_used.slice(0, 10) : [],
        top_skills: Array.isArray(top_skills) ? top_skills.slice(0, 10) : [],
        session_date: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }])
      .select();
    
    if (error) throw error;
    
    res.json({ 
      success: true, 
      data: data[0],
      rate_limit: { remaining: rateCheck.remaining }
    });
  } catch (err) {
    console.error('Activity log error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update agent profile (authenticated + ownership)
app.patch('/api/agents/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify ownership
    const ownership = await verifyAgentOwnership(id, req.user.id);
    if (!ownership.valid) {
      return res.status(403).json({ success: false, error: ownership.error });
    }
    
    const { agent_name, description, skills, platforms, public: isPublic } = req.body;
    
    const updates = {};
    if (agent_name !== undefined) updates.agent_name = agent_name.trim().slice(0, 100);
    if (description !== undefined) updates.description = description.trim().slice(0, 500);
    if (skills !== undefined) updates.skills = Array.isArray(skills) ? skills.slice(0, 20) : [];
    if (platforms !== undefined) updates.platforms = Array.isArray(platforms) ? platforms.slice(0, 10) : [];
    if (isPublic !== undefined) updates.public = !!isPublic;
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('agent_profiles')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (err) {
    console.error('Update agent error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete agent (authenticated + ownership)
app.delete('/api/agents/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify ownership
    const ownership = await verifyAgentOwnership(id, req.user.id);
    if (!ownership.valid) {
      return res.status(403).json({ success: false, error: ownership.error });
    }
    
    const { error } = await supabase
      .from('agent_profiles')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Agent deleted' });
  } catch (err) {
    console.error('Delete agent error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// STATIC PAGE ROUTES
// ============================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/leaderboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'leaderboard.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/features', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'features.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

module.exports = app;
