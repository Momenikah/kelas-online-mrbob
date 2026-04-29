const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireRole } = require('../middleware/auth');

const isAdmin = requireRole('admin');

router.get('/', isAdmin, adminController.dashboard);
router.get('/users', isAdmin, adminController.users);
router.post('/users', isAdmin, adminController.createUser);
router.post('/users/:id/toggle-status', isAdmin, adminController.toggleUserStatus);
router.post('/users/:id/toggle-vip', isAdmin, adminController.toggleVip);
router.get('/programs', isAdmin, adminController.programs);
router.post('/programs', isAdmin, adminController.createProgram);
router.get('/enrollments', isAdmin, adminController.enrollments);
router.post('/enrollments', isAdmin, adminController.createEnrollment);

module.exports = router;
