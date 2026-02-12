const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase configuration
const SUPABASE_URL = 'https://syjlapnrysfqagpcnwsd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5amxhcG5yeXNmMXFnYWZxY25wd3NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzkyNTY5MjQsImV4cCI6MjA1NDgzMjkyNH0.demo_key'; // Public anon key

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CORS
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'https://crediumai.com']
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.static('public'));

// API Routes

// Get leaderboard
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

// Get agent profile
app.get('/api/agents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get profile
    const { data: profile, error: profileError } = await supabase
      .from('agent_profiles')
      .select('*')
      .eq('id', id)
      .single();
    
    if (profileError) throw profileError;
    
    // Get activity
    const { data: activity, error: activityError } = await supabase
      .from('agent_activity')
      .select('*')
      .eq('agent_profile_id', id)
      .order('session_date', { ascending: false })
      .limit(30);
    
    if (activityError) throw activityError;
    
    // Get badges
    const { data: badges, error: badgesError } = await supabase
      .from('agent_badges')
      .select('*')
      .eq('agent_profile_id', id)
      .order('earned_at', { ascending: false });
    
    if (badgesError) throw badgesError;
    
    res.json({
      success: true,
      data: {
        profile,
        activity,
        badges
      }
    });
  } catch (err) {
    console.error('Agent fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create agent profile
app.post('/api/agents', async (req, res) => {
  try {
    const { agent_name, description, skills, platforms } = req.body;
    
    const { data, error } = await supabase
      .from('agent_profiles')
      .insert([{ agent_name, description, skills, platforms }])
      .select();
    
    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (err) {
    console.error('Create agent error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Log agent activity
app.post('/api/activity', async (req, res) => {
  try {
    const activity = req.body;
    
    const { data, error } = await supabase
      .from('agent_activity')
      .insert([activity])
      .select();
    
    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (err) {
    console.error('Activity log error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve new landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 CrediumAI Agent Resume API running on port ${PORT}`);
  console.log(`📊 Supabase connected: ${SUPABASE_URL}`);
});
