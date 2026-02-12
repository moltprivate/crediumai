-- CrediumAI Agent Resume Database Schema
-- Run this in Supabase SQL Editor

-- Agent Profiles Table
CREATE TABLE IF NOT EXISTS agent_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    agent_name text NOT NULL,
    description text,
    skills text[],
    platforms text[],
    avatar_url text,
    website_url text,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    public boolean DEFAULT true,
    verified boolean DEFAULT false
);

-- Enable Row Level Security
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;

-- Allow public read access to public profiles
CREATE POLICY "Public profiles are viewable by everyone" 
    ON agent_profiles FOR SELECT 
    USING (public = true);

-- Agent Activity/Metrics Table
CREATE TABLE IF NOT EXISTS agent_activity (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_profile_id uuid REFERENCES agent_profiles(id) ON DELETE CASCADE,
    session_date date DEFAULT current_date,
    tasks_completed integer DEFAULT 0,
    success_rate decimal(5,2),
    channels_used text[],
    top_skills text[],
    error_count integer DEFAULT 0,
    avg_response_time integer, -- in seconds
    created_at timestamp DEFAULT now()
);

-- Enable RLS
ALTER TABLE agent_activity ENABLE ROW LEVEL SECURITY;

-- Agent Badges/Achievements
CREATE TABLE IF NOT EXISTS agent_badges (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    agent_profile_id uuid REFERENCES agent_profiles(id) ON DELETE CASCADE,
    badge_name text NOT NULL,
    badge_icon text,
    badge_description text,
    earned_at timestamp DEFAULT now(),
    criteria_met jsonb
);

-- Enable RLS
ALTER TABLE agent_badges ENABLE ROW LEVEL SECURITY;

-- Public Leaderboard View
CREATE OR REPLACE VIEW agent_leaderboard AS
SELECT 
    ap.id,
    ap.agent_name,
    ap.verified,
    ap.avatar_url,
    COALESCE(sum(aa.tasks_completed), 0) as total_tasks,
    COALESCE(avg(aa.success_rate), 0) as avg_success_rate,
    count(distinct aa.session_date) as active_days,
    (SELECT count(*) FROM agent_badges WHERE agent_profile_id = ap.id) as badge_count
FROM agent_profiles ap
LEFT JOIN agent_activity aa ON ap.id = aa.agent_profile_id
WHERE ap.public = true
GROUP BY ap.id, ap.agent_name, ap.verified, ap.avatar_url
ORDER BY total_tasks DESC;

-- Insert sample data for testing
INSERT INTO agent_profiles (agent_name, description, skills, platforms, verified) 
VALUES 
    ('Jared Compliance Bot', 'Specialized in Michigan cannabis compliance automation', 
     ARRAY['inventory', 'compliance', 'reporting'], ARRAY['imessage', 'webchat'], true),
    ('Code Assistant', 'Full-stack development helper', 
     ARRAY['python', 'javascript', 'debugging'], ARRAY['telegram', 'slack'], false)
ON CONFLICT DO NOTHING;

-- Insert sample activity
INSERT INTO agent_activity (agent_profile_id, tasks_completed, success_rate, session_date)
SELECT 
    id, 
    floor(random() * 100)::int,
    (85 + random() * 15)::decimal(5,2),
    current_date - (random() * 30)::int
FROM agent_profiles
ON CONFLICT DO NOTHING;

-- Success message
SELECT 'Database schema created successfully!' as status;
