import React, { useState } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
  AppBar,
  Toolbar,
  Typography,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Container,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Event as EventIcon,
  Assessment as AssessmentIcon,
  Sync as SyncIcon,
  School as SchoolIcon,
} from '@mui/icons-material';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import Meetings from './pages/Meetings';
import Reports from './pages/Reports';
import SyncPage from './pages/SyncPage';
import Classes from './pages/Classes';

const theme = createTheme({
  palette: {
    primary: {
      main: '#5B21B6', // Purple
    },
    secondary: {
      main: '#7C3AED',
    },
  },
});

const drawerWidth = 240;

type Page = 'dashboard' | 'students' | 'meetings' | 'classes' | 'reports' | 'sync';

function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const menuItems = [
    { id: 'dashboard' as Page, label: 'Dashboard', icon: <DashboardIcon /> },
    { id: 'classes' as Page, label: 'Classes', icon: <SchoolIcon /> },
    { id: 'students' as Page, label: 'Students', icon: <PeopleIcon /> },
    { id: 'meetings' as Page, label: 'Meetings', icon: <EventIcon /> },
    { id: 'reports' as Page, label: 'Reports', icon: <AssessmentIcon /> },
    { id: 'sync' as Page, label: 'Sync Data', icon: <SyncIcon /> },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'classes':
        return <Classes />;
      case 'students':
        return <Students />;
      case 'meetings':
        return <Meetings />;
      case 'reports':
        return <Reports />;
      case 'sync':
        return <SyncPage />;
      default:
        return <Dashboard />;
    }
  };

  const drawer = (
    <div>
      <Toolbar>
        <Typography variant="h6" noWrap component="div">
          Attendance Tracker
        </Typography>
      </Toolbar>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.id} disablePadding>
            <ListItemButton
              selected={currentPage === item.id}
              onClick={() => {
                setCurrentPage(item.id);
                setMobileOpen(false);
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </div>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex' }}>
        <AppBar
          position="fixed"
          sx={{
            width: { sm: `calc(100% - ${drawerWidth}px)` },
            ml: { sm: `${drawerWidth}px` },
          }}
        >
          <Toolbar>
            <IconButton
              color="inherit"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2, display: { sm: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap component="div">
              Microsoft Teams Attendance Tracker
            </Typography>
          </Toolbar>
        </AppBar>
        <Box
          component="nav"
          sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
        >
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{
              keepMounted: true,
            }}
            sx={{
              display: { xs: 'block', sm: 'none' },
              '& .MuiDrawer-paper': {
                boxSizing: 'border-box',
                width: drawerWidth,
              },
            }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            sx={{
              display: { xs: 'none', sm: 'block' },
              '& .MuiDrawer-paper': {
                boxSizing: 'border-box',
                width: drawerWidth,
              },
            }}
            open
          >
            {drawer}
          </Drawer>
        </Box>
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            width: { sm: `calc(100% - ${drawerWidth}px)` },
          }}
        >
          <Toolbar />
          <Container maxWidth="xl">
            {renderPage()}
          </Container>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
