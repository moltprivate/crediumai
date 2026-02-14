-- CrediumAI Agent Resume Database Schema with Auth
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- AGENT PROFILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS agent_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- Enable RLS
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;

-- Policies for agent_profiles

-- Anyone can view public profiles
CREATE POLICY "Public profiles are viewable by everyone" 
    ON agent_profiles FOR SELECT 
    USING (public = true);

-- Users can view their own private profiles
CREATE POLICY "Users can view their own private profiles"
    ON agent_profiles FOR SELECT
    USING (auth.uid() = user_id);

-- Authenticated users can create profiles (sets user_id automatically via trigger)
CREATE POLICY "Authenticated users can create profiles"
    ON agent_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own profiles
CREATE POLICY "Users can update their own profiles"
    ON agent_profiles FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own profiles
CREATE POLICY "Users can delete their own profiles"
    ON agent_profiles FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- AGENT ACTIVITY TABLE
-- ============================================
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

-- Policies for agent_activity

-- Activity is viewable if the agent profile is public or owned by user
CREATE POLICY "Activity viewable for public agents or owner"
    ON agent_activity FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_activity.agent_profile_id 
            AND (agent_profiles.public = true OR agent_profiles.user_id = auth.uid())
        )
    );

-- Users can insert activity for their own agents
CREATE POLICY "Users can insert activity for their agents"
    ON agent_activity FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_activity.agent_profile_id 
            AND agent_profiles.user_id = auth.uid()
        )
    );

-- Users can update activity for their own agents
CREATE POLICY "Users can update activity for their agents"
    ON agent_activity FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_activity.agent_profile_id 
            AND agent_profiles.user_id = auth.uid()
        )
    );

-- Users can delete activity for their own agents
CREATE POLICY "Users can delete activity for their agents"
    ON agent_activity FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_activity.agent_profile_id 
            AND agent_profiles.user_id = auth.uid()
        )
    );

-- ============================================
-- AGENT BADGES TABLE
-- ============================================
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

-- Policies for agent_badges

-- Badges viewable if agent is public or owned by user
CREATE POLICY "Badges viewable for public agents or owner"
    ON agent_badges FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_badges.agent_profile_id 
            AND (agent_profiles.public = true OR agent_profiles.user_id = auth.uid())
        )
    );

-- Users can manage badges for their agents
CREATE POLICY "Users can insert badges for their agents"
    ON agent_badges FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_badges.agent_profile_id 
            AND agent_profiles.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete badges for their agents"
    ON agent_badges FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM agent_profiles 
            WHERE agent_profiles.id = agent_badges.agent_profile_id 
            AND agent_profiles.user_id = auth.uid()
        )
    );

-- ============================================
-- PUBLIC LEADERBOARD VIEW
-- ============================================
CREATE OR REPLACE VIEW agent_leaderboard AS
SELECT 
    ap.id,
    ap.agent_name,
    ap.verified,
    ap.avatar_url,
    ap.user_id,
    COALESCE(sum(aa.tasks_completed), 0) as total_tasks,
    COALESCE(avg(aa.success_rate), 0) as avg_success_rate,
    count(distinct aa.session_date) as active_days,
    (SELECT count(*) FROM agent_badges WHERE agent_profile_id = ap.id) as badge_count
FROM agent_profiles ap
LEFT JOIN agent_activity aa ON ap.id = aa.agent_profile_id
WHERE ap.public = true
GROUP BY ap.id, ap.agent_name, ap.verified, ap.avatar_url, ap.user_id
ORDER BY total_tasks DESC;

-- ============================================
-- TRIGGERS
-- ============================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_agent_profiles_updated_at
    BEFORE UPDATE ON agent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================

-- Insert sample data for testing (only if no data exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM agent_profiles LIMIT 1) THEN
        INSERT INTO agent_profiles (agent_name, description, skills, platforms, verified, public) 
        VALUES 
            ('Jared The Lobster', 'A helpful automation agent specializing in data processing and task automation', 
             ARRAY['data processing', 'automation', 'reporting'], ARRAY['openclaw', 'discord'], true, true),
            ('Code Assistant', 'Full-stack development helper', 
             ARRAY['python', 'javascript', 'debugging'], ARRAY['telegram', 'slack'], false, true);
             
        -- Insert sample activity
        INSERT INTO agent_activity (agent_profile_id, tasks_completed, success_rate, session_date)
        SELECT 
            id, 
            floor(random() * 100)::int,
            (85 + random() * 15)::decimal(5,2),
            current_date - (random() * 30)::int
        FROM agent_profiles;
    END IF;
END $$;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_agent_profiles_user_id ON agent_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_public ON agent_profiles(public) WHERE public = true;
CREATE INDEX IF NOT EXISTS idx_agent_activity_agent_id ON agent_activity(agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_badges_agent_id ON agent_badges(agent_profile_id);

-- Success message
SELECT 'Database schema with Auth RLS created successfully!' as status;