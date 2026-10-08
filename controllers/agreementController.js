import Agreement from '../models/Agreement.js';
import Tenant from '../models/Tenant.js';
import Shop from '../models/Shop.js';

// @desc    Get all agreements with populated shop and tenant details
export const getAgreements = async (req, res) => {
  try {
    const agreements = await Agreement.find()
      .populate('shops')
      .populate('tenant')
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: agreements.length, data: agreements });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createAgreement = async (req, res) => {
  try {
    const {
      shopIds, // Ab yahan array aayega (e.g., ['id1', 'id2'])
      tenantId,
      tenantName,
      tenantCnic,
      tenantPhone,
      tenantWhatsApp,
      tenantAddress,
      emergencyContact,
      startDate,
      endDate,
      rentAmount,
      securityDeposit,
      incrementPercentage,
    } = req.body;

    // 1. Validate shops array
    if (!shopIds || !Array.isArray(shopIds) || shopIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one shop.' });
    }

    // Check if all selected shops are available
    const shops = await Shop.find({ _id: { $in: shopIds } });
    if (shops.length !== shopIds.length) {
      return res.status(404).json({ success: false, message: 'One or more shops not found.' });
    }

    for (let shop of shops) {
      if (shop.status === 'Occupied') {
        return res.status(400).json({ success: false, message: `Shop #${shop.shopNumber} is already occupied!` });
      }
    }

    let finalTenantId = tenantId;

    // 2. If tenantId is NOT provided, create a new tenant on the fly
    if (!finalTenantId) {
      if (!tenantCnic || !tenantName) {
        return res.status(400).json({ success: false, message: 'Tenant Name and CNIC are required for new tenant.' });
      }

      let existingTenant = await Tenant.findOne({ cnic: tenantCnic });
      if (existingTenant) {
        finalTenantId = existingTenant._id;
      } else {
        let documentPaths = [];
        if (req.files && req.files.length > 0) {
          documentPaths = req.files.map(file => file.path);
        }

        const newTenant = await Tenant.create({
          name: tenantName,
          cnic: tenantCnic,
          phone: tenantPhone,
          whatsapp: tenantWhatsApp,
          permanentAddress: tenantAddress,
          emergencyContact,
          documents: documentPaths,
        });
        finalTenantId = newTenant._id;
      }
    }

    // 3. Create Agreement with multiple shops array
    const agreement = await Agreement.create({
      shops: shopIds, // Schema mein field ka naam 'shops' rakhein (array of ObjectIds)
      tenant: finalTenantId,
      startDate,
      endDate,
      monthlyRent: rentAmount,
      securityDeposit,
      incrementPercentage: incrementPercentage || 10,
      status: 'Active',
    });

    // 4. Update all selected shops status to Occupied
    await Shop.updateMany({ _id: { $in: shopIds } }, {$set: { status: 'Occupied' } });

    res.status(201).json({
      success: true,
      message: 'Lease agreement created successfully for multiple shops!',
      data: agreement,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete/Terminate agreement and free up the shop
export const deleteAgreement = async (req, res) => {
  try {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement) {
      return res.status(404).json({ success: false, message: 'Agreement not found' });
    }

    // Free up the shop
    await Shop.findByIdAndUpdate(agreement.shop, { status: 'Available' });

    await agreement.deleteOne();
    res.status(200).json({ success: true, message: 'Agreement terminated and shop set to available' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};