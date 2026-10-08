import Shop from '../models/Shop.js';

// @desc    Get all shops
export const getShops = async (req, res) => {
  try {
    const shops = await Shop.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: shops.length, data: shops });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}; 

// @desc    Add a new shop
export const createShop = async (req, res) => {
  try {
    const { shopNumber, floor, utilityZone, sizeSqFt, type, status } = req.body;

    const shopExists = await Shop.findOne({ shopNumber });
    if (shopExists) {
      return res.status(400).json({ success: false, message: 'Shop number already exists' });
    }

    const shop = await Shop.create({
      shopNumber,
      floor,
      utilityZone,
      sizeSqFt,
      type,
      status,
    });

    res.status(201).json({ success: true, message: 'Shop added successfully', data: shop });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Update shop details
export const updateShop = async (req, res) => {
  try {
    let shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    shop = await Shop.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ success: true, message: 'Shop updated successfully', data: shop });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Delete a shop
export const deleteShop = async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    await shop.deleteOne();
    res.status(200).json({ success: true, message: 'Shop deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};