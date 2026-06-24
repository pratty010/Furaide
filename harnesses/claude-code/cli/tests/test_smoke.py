def test_package_importable():
    import mekiki
    assert mekiki.__version__ == "0.1.0"
