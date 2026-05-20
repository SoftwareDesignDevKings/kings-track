-- Create meetings table
CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teams_meeting_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(500),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    organizer_email VARCHAR(255),
    meeting_url TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_meetings_teams_meeting_id ON meetings(teams_meeting_id);
CREATE INDEX idx_meetings_start_time ON meetings(start_time);
CREATE INDEX idx_meetings_end_time ON meetings(end_time);
CREATE INDEX idx_meetings_organizer_email ON meetings(organizer_email);

-- Add check constraint to ensure end_time is after start_time
ALTER TABLE meetings ADD CONSTRAINT check_meeting_times
    CHECK (end_time > start_time);

-- Add comments for documentation
COMMENT ON TABLE meetings IS 'Stores Microsoft Teams meeting information';
COMMENT ON COLUMN meetings.teams_meeting_id IS 'Unique identifier from Microsoft Teams';
COMMENT ON COLUMN meetings.meeting_url IS 'Join URL for the Teams meeting';
