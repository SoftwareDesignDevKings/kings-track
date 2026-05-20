import React, { useEffect, useState } from 'react';
import {
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  People as PeopleIcon,
  Event as EventIcon,
  CheckCircle as CheckCircleIcon,
  TrendingUp as TrendingUpIcon,
} from '@mui/icons-material';
import { apiService } from '../services/api';
import { Student, Meeting } from '../types';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';

interface MeetingSummary {
  total_enrolled: number;
  present: number;
  late: number;
  partial: number;
  absent: number;
}

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
  const [meetingSummaries, setMeetingSummaries] = useState<MeetingSummary[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [studentsData, meetingsData] = await Promise.all([
        apiService.getStudents(),
        apiService.getMeetings(50, 0),
      ]);

      setStudents(studentsData);
      setRecentMeetings(meetingsData);

      // Fetch attendance summaries with Canvas absence data for each meeting
      const summaries: MeetingSummary[] = [];
      for (const meeting of meetingsData) {
        try {
          const detail = await apiService.getMeetingAttendanceWithAbsences(meeting.id);
          if (detail?.summary) {
            summaries.push(detail.summary);
          }
        } catch {
          // Skip meetings that fail (e.g., no class code)
        }
      }
      setMeetingSummaries(summaries);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const getStats = () => {
    const totalStudents = students.length;
    const totalMeetings = recentMeetings.length;

    // Aggregate across all meeting summaries (includes Canvas-derived absences)
    const present = meetingSummaries.reduce((sum, s) => sum + s.present, 0);
    const late = meetingSummaries.reduce((sum, s) => sum + s.late, 0);
    const partial = meetingSummaries.reduce((sum, s) => sum + s.partial, 0);
    const absent = meetingSummaries.reduce((sum, s) => sum + s.absent, 0);
    const totalAttendance = present + late + partial + absent;

    const attendanceRate = totalAttendance > 0
      ? Math.round(((present + late) / totalAttendance) * 100)
      : 0;

    return { totalStudents, totalMeetings, totalAttendance, present, late, partial, absent, attendanceRate };
  };

  const stats = getStats();

  const statusData = [
    { name: 'Present', value: stats.present, color: '#10B981' },
    { name: 'Late', value: stats.late, color: '#F59E0B' },
    { name: 'Partial', value: stats.partial, color: '#3B82F6' },
    { name: 'Absent', value: stats.absent, color: '#EF4444' },
  ];

  const StatCard: React.FC<{ title: string; value: number; icon: React.ReactNode; color: string }> = ({
    title,
    value,
    icon,
    color,
  }) => (
    <Card elevation={2}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography color="textSecondary" variant="body2" gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4" fontWeight="bold">
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              backgroundColor: color,
              borderRadius: '50%',
              width: 56,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" onClose={() => setError(null)}>
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Dashboard
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        Overview of attendance tracking
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }, gap: 3, mb: 4 }}>
        <StatCard
          title="Total Students"
          value={stats.totalStudents}
          icon={<PeopleIcon fontSize="large" />}
          color="#5B21B6"
        />
        <StatCard
          title="Recent Meetings"
          value={stats.totalMeetings}
          icon={<EventIcon fontSize="large" />}
          color="#7C3AED"
        />
        <StatCard
          title="Attendance Records"
          value={stats.totalAttendance}
          icon={<CheckCircleIcon fontSize="large" />}
          color="#10B981"
        />
        <StatCard
          title="Attendance Rate"
          value={stats.attendanceRate}
          icon={<TrendingUpIcon fontSize="large" />}
          color="#F59E0B"
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <Box>
          <Paper elevation={2} sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Attendance Status Distribution
            </Typography>
            {stats.totalAttendance > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={300}>
                <Typography color="textSecondary">No attendance data available</Typography>
              </Box>
            )}
          </Paper>
        </Box>

        <Box>
          <Paper elevation={2} sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Recent Meetings
            </Typography>
            {recentMeetings.length > 0 ? (
              <Box>
                {recentMeetings.map((meeting) => (
                  <Box
                    key={meeting.id}
                    sx={{
                      p: 2,
                      mb: 1,
                      borderRadius: 1,
                      bgcolor: '#F3F4F6',
                      '&:hover': { bgcolor: '#E5E7EB' },
                    }}
                  >
                    <Typography variant="subtitle1" fontWeight="bold">
                      {meeting.title || 'Untitled Meeting'}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {new Date(meeting.start_time).toLocaleString()}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={250}>
                <Typography color="textSecondary">No recent meetings</Typography>
              </Box>
            )}
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
